import styles from './Avatar.module.css';

const sizeMap = { sm: 28, md: 34, lg: 42 };

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name = '', src, size = 'md' }) {
  const px = sizeMap[size] || sizeMap.md;
  const fontSize = Math.round(px * 0.38);

  return (
    <div
      className={`${styles.avatar} ${src ? styles.hasImage : styles.initials}`}
      style={{ width: px, height: px, minWidth: px, fontSize }}
      title={name}
    >
      {src ? (
        <img src={src} alt={name} className={styles.image} />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}
