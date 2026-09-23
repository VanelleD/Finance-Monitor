/**
 * The first thing you see: the time of day, and what your own numbers say
 * about it right now.
 *
 * Every line here is computed locally from data already on screen — no request
 * leaves the app to produce them.
 */

import type { Insight, Tone } from "@shared/insights.js";
import { greetingFor } from "@shared/insights.js";
import { Icon, type IconName } from "../lib/icons.js";
import { wash } from "../lib/present.js";

const TONES: Record<Tone, { color: string; icon: IconName }> = {
  urgent: { color: "var(--down)", icon: "alert" },
  watch: { color: "var(--warn)", icon: "alert" },
  good: { color: "var(--up)", icon: "check" },
  neutral: { color: "var(--series-3)", icon: "note" },
};

export function Greeting({
  insights, today, now = new Date(),
}: { insights: Insight[]; today: string; now?: Date }) {
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className="greeting">
      <div className="greeting__head">
        <h2 className="greeting__hello serif">{greetingFor(now)}</h2>
        <p className="greeting__date">{dateLabel}</p>
      </div>

      {insights.length > 0 ? (
        <ul className="greeting__list">
          {insights.map((insight) => {
            const { color, icon } = TONES[insight.tone];
            return (
              <li className="greeting__item" key={insight.id}>
                <span
                  className="greeting__mark"
                  style={{ background: wash(color), color }}
                  aria-hidden="true"
                >
                  <Icon name={icon} size={13} strokeWidth={2.1} />
                </span>
                <span>{insight.text}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="greeting__quiet">Nothing needs your attention right now.</p>
      )}
    </section>
  );
}
