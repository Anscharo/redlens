import { useEffect, useState } from "react";

const utcDay = () => new Date().toISOString().slice(0, 10);

/** Current UTC calendar day (YYYY-MM-DD), updating when midnight passes —
 *  so day-keyed memos recompute in long-lived tabs instead of freezing at
 *  mount time. */
export function useUTCDay(): string {
  const [day, setDay] = useState(utcDay);
  useEffect(() => {
    const id = setInterval(() => {
      const d = utcDay();
      setDay((prev) => (prev === d ? prev : d));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return day;
}
