'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  rating: number;
  size?: number;
  showValue?: boolean;
  className?: string;
}

function getStarType(index: number, rating: number): 'full' | 'half' | 'empty' {
  if (rating >= index) return 'full';
  if (rating >= index - 0.5) return 'half';
  return 'empty';
}

export function StarRating({
  rating,
  size = 14,
  showValue = false,
  className,
}: StarRatingProps) {
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const type = getStarType(i, rating);
        return (
          <span key={i} className="relative inline-flex" style={{ width: size, height: size }}>
            {/* Empty star (background) */}
            <Star
              className="absolute inset-0 text-slate-300"
              size={size}
              strokeWidth={1.5}
            />
            {/* Filled star */}
            {type === 'full' && (
              <Star
                className="absolute inset-0 fill-amber-400 text-amber-400"
                size={size}
                strokeWidth={1.5}
              />
            )}
            {/* Half-filled star using clip */}
            {type === 'half' && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: size / 2 }}
              >
                <Star
                  className="fill-amber-400 text-amber-400"
                  size={size}
                  strokeWidth={1.5}
                />
              </span>
            )}
          </span>
        );
      })}
      {showValue && (
        <span className="ml-1 text-sm font-medium text-slate-700">
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}

interface InteractiveStarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  size?: number;
  className?: string;
}

export function InteractiveStarRating({
  rating,
  onRatingChange,
  size = 24,
  className,
}: InteractiveStarRatingProps) {
  const [hoveredStar, setHoveredStar] = useState<number>(0);

  const displayRating = hoveredStar > 0 ? hoveredStar : rating;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const isFilled = i <= displayRating;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onRatingChange(i)}
            onMouseEnter={() => setHoveredStar(i)}
            onMouseLeave={() => setHoveredStar(0)}
            className="cursor-pointer transition-transform hover:scale-110 focus:outline-none"
            aria-label={`${i} étoile${i > 1 ? 's' : ''}`}
          >
            <Star
              size={size}
              strokeWidth={1.5}
              className={
                isFilled
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-slate-300'
              }
            />
          </button>
        );
      })}
      {rating > 0 && (
        <span className="ml-2 text-sm font-medium text-slate-600">
          {rating}/5
        </span>
      )}
    </div>
  );
}
