import logomarkSrc from '../assets/01_Logo/03_Logomark/Digital/01_Full_Colour/Logomark-01.png';
import styles from './AppColdLoader.module.css';

export default function AppColdLoader({
  title = 'STACK N STOCK',
  subtitle = 'Preparing your workspace',
}) {
  return (
    <div className={styles.loaderContainer} role="status" aria-live="polite">
      <div className={styles.loaderContent}>
        <div className={styles.markWrapper}>
          <div className={styles.ambientGlow} />
          <div className={styles.orbitRing} />
          <div className={styles.orbitRingInner} />
          <img
            src={logomarkSrc}
            alt="Stack n Stock"
            className={styles.logoImg}
          />
        </div>

        <div className={styles.textGroup}>
          <h1 className={styles.brandTitle}>{title}</h1>
          <p className={styles.statusText}>{subtitle}</p>
          <div className={styles.progressBarTrack} aria-hidden="true">
            <div className={styles.progressBarIndeterminate} />
          </div>
        </div>
      </div>
    </div>
  );
}
