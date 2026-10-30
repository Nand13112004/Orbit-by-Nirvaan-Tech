import Image from 'next/image';

export function Brand({ compact = false, dark = false, href = '/' }: { compact?: boolean; dark?: boolean; href?: string }) {
  return (
    <a className="flex min-w-0 items-center gap-3" href={href} aria-label="Orbit by Nirvaan Tech">
      <Image
        className={`brand-mark${compact ? ' brand-mark-small' : ''}`}
        src="/orbit-mark.webp"
        alt="Orbit symbol"
        width={42}
        height={42}
        priority
      />
      <span className="min-w-0 leading-tight">
        <span className={`block text-[15px] font-bold tracking-[.13em] ${dark ? 'text-white' : 'text-[#111827]'}`}>ORBIT</span>
        <span className={`mt-1 block text-[10px] font-medium tracking-wide ${dark ? 'text-[#a1a1aa]' : 'text-[#6b7280]'}`}>by Nirvaan Tech</span>
      </span>
    </a>
  );
}
