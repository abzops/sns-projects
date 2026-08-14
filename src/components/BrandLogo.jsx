import whiteLogo from '../assets/01_Logo/01_Horizontal_Logo/Digital/03_White/white-01.png';

export default function BrandLogo({ className, height = 28, alt = 'Stack n Stock' }) {
  return (
    <img
      src={whiteLogo}
      alt={alt}
      className={className}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: 'auto',
        maxWidth: '100%',
        objectFit: 'contain',
        display: 'block',
      }}
    />
  );
}
