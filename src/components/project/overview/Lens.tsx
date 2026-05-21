export function Lens() {
  return (
    <svg className="cl-lens" viewBox="0 0 540 540" aria-hidden="true">
      <circle className="ring-1" cx="270" cy="270" r="260" />
      <circle className="ring-2" cx="270" cy="270" r="210" />
      <circle className="ring-3" cx="270" cy="270" r="160" />
      <circle className="ring-4" cx="270" cy="270" r="110" />
      <line className="crosshair" x1="0" y1="270" x2="540" y2="270" />
      <line className="crosshair" x1="270" y1="0" x2="270" y2="540" />
      <path className="arc" d="M 270 10 A 260 260 0 0 1 530 270" />
      <circle className="pupil" cx="270" cy="270" r="22" />
    </svg>
  )
}
