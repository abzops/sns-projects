import styles from './Spinner.module.css';

const sizeMap = { sm: 20, md: 32, lg: 48 };

export default function Spinner({ size = 'md' }) {
  const px = sizeMap[size] || sizeMap.md;

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.spinner}
        style={{ width: px, height: px, borderWidth: Math.max(2, px / 8) }}
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
