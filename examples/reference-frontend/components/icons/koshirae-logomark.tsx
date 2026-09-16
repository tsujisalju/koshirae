import KoshiraeLogo from "./koshirae-logo";

export default function KoshiraeLogomark() {
  return (
    <div className="flex items-center gap-3">
      <KoshiraeLogo className="size-10" />
      <p className="font-display text-2xl font-light">Koshirae</p>
    </div>
  );
}
