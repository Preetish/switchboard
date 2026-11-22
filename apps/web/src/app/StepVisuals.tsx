import Image from "next/image";
import styles from "./StepVisuals.module.css";

/**
 * The three How-it-works visuals, framed as crisp obsidian miniature product
 * stages inside the light editorial step cards. StepsSequence plays each once
 * in order; the base state is the finished, readable state for no-JS and
 * reduced-motion visitors.
 */

export function QualifyVisual() {
  return (
    <div className={styles.visual} aria-hidden="true">
      <div className={styles.miniForm}>
        <span className={`${styles.field} ${styles.d1}`}>jane@globex.com</span>
        <span className={`${styles.field} ${styles.d2}`}>400 employees</span>
        <span className={`${styles.field} ${styles.d3}`}>Canada</span>
      </div>
      <div className={styles.checks}>
        <span className={`${styles.check} ${styles.d4}`}>✓ Company size</span>
        <span className={`${styles.check} ${styles.d5}`}>✓ Country</span>
        <span className={`${styles.pill} ${styles.d6}`}>Qualified</span>
      </div>
    </div>
  );
}

export function RouteVisual() {
  return (
    <div className={styles.visual} aria-hidden="true">
      <div className={`${styles.avatars} ${styles.d1}`}>
        <span className={`${styles.avatarRing} ${styles.scan1}`}>
          <Image
            src="/reps/benito.jpg"
            alt=""
            width={44}
            height={44}
            className={styles.avatarImg}
          />
        </span>
        <span className={`${styles.avatarRing} ${styles.picked}`}>
          <Image
            src="/reps/alice.jpg"
            alt=""
            width={44}
            height={44}
            className={styles.avatarImg}
          />
        </span>
        <span className={`${styles.avatarRing} ${styles.scan2}`}>
          <Image
            src="/reps/claire.jpg"
            alt=""
            width={44}
            height={44}
            className={styles.avatarImg}
          />
        </span>
      </div>
      <p className={`${styles.pickLabel} ${styles.d6}`}>
        Alice Chen · Enterprise team
      </p>
      <p className={`${styles.pickSub} ${styles.d7}`}>Round-robin · next up</p>
    </div>
  );
}

export function BookVisual() {
  return (
    <div className={styles.visual} aria-hidden="true">
      <div className={styles.week}>
        {["M", "T", "W", "T", "F"].map((d, i) => (
          <span
            key={i}
            className={`${styles.dayCell} ${i === 1 ? styles.dayPicked : ""} ${
              styles[`d${i + 1}`]
            }`}
          >
            {d}
          </span>
        ))}
      </div>
      <div className={styles.slots}>
        <span className={`${styles.slot} ${styles.slotPicked} ${styles.d5}`}>
          9:30 AM
        </span>
        <span className={`${styles.slot} ${styles.d6}`}>10:00 AM</span>
        <span className={`${styles.slot} ${styles.d7}`}>11:30 AM</span>
      </div>
      <p className={`${styles.bookedLine} ${styles.d8}`}>
        ✓ Booked · Meet link sent
      </p>
    </div>
  );
}
