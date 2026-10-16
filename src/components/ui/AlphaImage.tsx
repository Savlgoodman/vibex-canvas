import type { ImgHTMLAttributes } from 'react';
import { useHasAlpha } from '../../hooks/useHasAlpha';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  small?: boolean;
}

/** Renders an image and adds the checkerboard only when the file has transparent pixels. */
export function AlphaImage({ src, className, small, alt = '', ...rest }: Props) {
  const hasAlpha = useHasAlpha(src);
  const classes = [className, hasAlpha ? 'checkerboard' : '', hasAlpha && small ? 'checkerboard-sm' : '']
    .filter(Boolean)
    .join(' ');
  return <img src={src} alt={alt} className={classes} {...rest} />;
}
