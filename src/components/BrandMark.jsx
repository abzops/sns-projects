import markLogo from '../assets/01_Logo/03_Logomark/Digital/01_Full_Colour/Logomark-01.png';

export default function BrandMark({ className, size = 32, alt = 'Stack n Stock Logomark' }) {
  return (
    <img
      src={markLogo}
      alt={alt}
      className={className}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  );
}
