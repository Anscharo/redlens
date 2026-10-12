const SKY_LOGO_PX = 12;

export function CopyIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <path d="M1 8V2C1 1.45 1.45 1 2 1H8" />
    </svg>
  );
}

export function SkyLogo() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}sky.png`}
      alt=""
      aria-hidden="true"
      width={SKY_LOGO_PX}
      height={SKY_LOGO_PX}
      className="atlas-sky-logo block"
    />
  );
}

export function LinkOutIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m15 14 5-5-5-5" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}
