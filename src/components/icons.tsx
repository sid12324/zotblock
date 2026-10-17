import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function BrandMark(props: IconProps) {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}><rect width="32" height="32" rx="10" fill="currentColor"/><path d="M10 10h7a5 5 0 0 1 0 10h-7m12 2h-7a5 5 0 0 1 0-10h7" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"/><path d="M10 15h12" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"/></svg>;
}

export function GmailIcon(props: IconProps) {
  return <svg viewBox="0 0 40 32" fill="none" aria-hidden="true" {...props}><path d="M3 31h6V14L0 7v21a3 3 0 0 0 3 3Z" fill="#4285F4"/><path d="M31 31h6a3 3 0 0 0 3-3V7l-9 7v17Z" fill="#34A853"/><path d="M31 3v11l9-7V4a4 4 0 0 0-6.4-3.2L31 3Z" fill="#FBBC04"/><path d="M9 14V3l11 8 11-8v11L20 22 9 14Z" fill="#EA4335"/><path d="M0 4v3l9 7V3L6.4.8A4 4 0 0 0 0 4Z" fill="#C5221F"/></svg>;
}

export function CalendarIcon(props: IconProps) {
  return <svg viewBox="0 0 36 36" fill="none" aria-hidden="true" {...props}><path d="M27 36H5a5 5 0 0 1-5-5V9h9v18h18v9Z" fill="#4285F4"/><path d="M36 9v18l-9 9v-9h-1V9h10Z" fill="#34A853"/><path d="M36 9H0V5a5 5 0 0 1 5-5h26a5 5 0 0 1 5 5v4Z" fill="#1967D2"/><path d="M27 27H9V9h18v18Z" fill="#fff"/><path d="M27 36v-9h9l-9 9Z" fill="#FBBC04"/><path d="M13 14c2-2 5-.7 5 1.2 0 .9-.5 1.5-1.2 1.9.9.4 1.4 1.1 1.4 2.1 0 2.7-3.7 3.4-5.6 1.5l1-1.2c1.2 1.2 2.9.9 2.9-.4 0-1-1.1-1.2-2.3-1.2v-1.4c1.1 0 2-.2 2-1.1 0-1.1-1.5-1.2-2.3-.3l-.9-1.1Zm9-1h1.5v9h-1.7v-6.9l-1.6 1.1-.8-1.3 2.6-1.9Z" fill="#4285F4"/></svg>;
}

export function CanvasIcon(props: IconProps) {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}><g fill="#E53A34">{Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 20 20)`}><circle cx="20" cy="5" r="2.7"/><rect x="17.7" y="10" width="4.6" height="7.2" rx="2.3"/></g>)}<circle cx="20" cy="20" r="3.2"/></g></svg>;
}

export function ArrowRight(props: IconProps) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function CheckIcon(props: IconProps) {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}><path d="m3.5 8.2 3 3 6-6.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function SparklesIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="m10 3 2.2 6.8L19 12l-6.8 2.2L10 21l-2.2-6.8L1 12l6.8-2.2L10 3ZM19 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>;
}
