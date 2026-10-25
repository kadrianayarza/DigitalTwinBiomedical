export function HealthButton({ onClick, label = 'Health' }: { onClick: () => void; label?: string }) {
  return (
    <button className="healthbtn" onClick={onClick} title="Health data, wearables and medications">
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
