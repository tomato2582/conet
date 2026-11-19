import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-10", className)} aria-hidden>
      <rect width="32" height="32" rx="11" fill="#F6DDD6" />
      <ellipse
        cx="16"
        cy="16"
        rx="13.2"
        ry="5.2"
        fill="none"
        stroke="#C2412D"
        strokeWidth="1.6"
        transform="rotate(-28 16 16)"
      />
      <path
        d="M22.6 9.2C17.4 5.4 8.2 7.6 8.2 16s9.2 10.6 14.4 6.8"
        fill="none"
        stroke="#1A1612"
        strokeWidth="5.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
