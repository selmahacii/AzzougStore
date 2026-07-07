import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBackendUrl(): string {
  let url = 'http://localhost:8003';
  if (process.env.BACKEND_URL) {
    url = process.env.BACKEND_URL;
  } else {
    const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (publicApiUrl && publicApiUrl.startsWith('http')) {
      url = publicApiUrl;
    } else if (process.env.VERCEL_URL) {
      url = `https://${process.env.VERCEL_URL}/_/backend`;
    }
  }

  if (url.includes('api.azghub.com')) {
    return 'https://selmabcpdchozz00-azzoug-backend.hf.space';
  }
  return url;
}

