import styles from './Avatar.module.css';

const sizeMap = { sm: 28, md: 34, lg: 42 };

function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const clean = name.trim();
  if (!clean) return '?';

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const firstChar = parts[0]?.charAt(0);
    return firstChar ? firstChar.toUpperCase() : '?';
  }

  const firstChar = parts[0]?.charAt(0) || '';
  const lastChar = parts[parts.length - 1]?.charAt(0) || '';
  const combined = (firstChar + lastChar).toUpperCase();
  return combined || '?';
}

export default function Avatar({ name, src, size = 'md' }) {
  const px = sizeMap[size] || sizeMap.md;
  const fontSize = Math.round(px * 0.38);
  const safeName = typeof name === 'string' ? name : '';

  return (
    <div
      className={`${styles.avatar} ${src ? styles.hasImage : styles.initials}`}
      style={{ width: px, height: px, minWidth: px, fontSize }}
      title={safeName || undefined}
    >
      {src ? (
        <img src={src} alt={safeName || 'Avatar'} className={styles.image} />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}
