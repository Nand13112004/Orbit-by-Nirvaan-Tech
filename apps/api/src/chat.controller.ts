import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthGuard } from './common';

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().trim().min(1).max(4000),
    }),
  ).min(1).max(20).refine(
    (messages) => messages.reduce((total, message) => total + message.content.length, 0) <= 16_000,
    'Chat history is too long',
  ),
});

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    const { messages } = chatSchema.parse(body);
    if (messages[messages.length - 1]?.role !== 'user') {
      throw new BadRequestException('The latest chat message must be from the user');
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Chat is not configured. Add OPENROUTER_API_KEY to the API environment.');
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 120_000);
    const abortOnDisconnect = () => {
      if (!response.writableEnded) abortController.abort();
    };
    response.once('close', abortOnDisconnect);

    let upstream: globalThis.Response;
    try {
      upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_ORIGIN ?? '',
          'X-Title': 'Orbit by Nirvaan Tech',
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          stream: true,
          max_tokens: 1024,
          messages: [
            {
              role: 'system',
              content: 'You are Orbit Assistant, a helpful and concise assistant inside the Orbit by Nirvaan Tech CRM. Give clear, polished answers that are easy to scan: use a short descriptive Markdown heading when useful, brief paragraphs, numbered steps for processes, and bullets for grouped items. Use **bold** sparingly for labels or key points, *italics* sparingly, and blockquotes only for a genuinely useful tip or note. Avoid excessive headings, long introductions, repeated conclusions, and irrelevant details. Be accurate about Orbit: do not claim features exist unless described in the conversation; distinguish general CRM practices from features available in this workspace. You cannot see or access the user’s leads, contacts, account data, or other private workspace records unless they include information in their message. Never claim to have accessed those records.',
            },
            ...messages,
          ],
        }),
        signal: abortController.signal,
      });
    } catch {
      clearTimeout(timeout);
      response.removeListener('close', abortOnDisconnect);
      if (response.destroyed) return;
      if (abortController.signal.aborted) {
        throw new BadGatewayException('The AI request timed out. Please try again.');
      }
      throw new BadGatewayException('Could not reach the AI service. Please try again.');
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timeout);
      response.removeListener('close', abortOnDisconnect);
      console.error(JSON.stringify({ event: 'openrouter_chat_error', status: upstream.status }));
      if (upstream.status === 429) {
        throw new BadGatewayException('The AI service is busy. Please wait a moment and try again.');
      }
      throw new BadGatewayException('The AI service could not complete your request. Please try again.');
    }

    try {
      response.status(200);
      response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      for await (const chunk of upstream.body) {
        if (response.destroyed) break;
        if (!response.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              response.removeListener('drain', onDrain);
              response.removeListener('close', onClose);
              response.removeListener('error', onError);
            };
            const onDrain = () => { cleanup(); resolve(); };
            const onClose = () => { cleanup(); resolve(); };
            const onError = (error: Error) => { cleanup(); reject(error); };
            response.once('drain', onDrain);
            response.once('close', onClose);
            response.once('error', onError);
          });
        }
      }
    } catch {
      if (!response.destroyed && !response.writableEnded) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: 'The AI response was interrupted. Please try again.' })}\n\n`);
      }
    } finally {
      clearTimeout(timeout);
      response.removeListener('close', abortOnDisconnect);
      if (!response.destroyed && !response.writableEnded) response.end();
    }
  }
}
