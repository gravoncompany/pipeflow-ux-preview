import logoAsset from "@/assets/pipeflow_logo.png.asset.json";
import { cn } from "@/lib/utils";

/** Single source of the Pipeflow logo: swap the asset here to update the whole app. */
export const PIPEFLOW_LOGO_URL = logoAsset.url;
export const PIPEFLOW_NAME = "PipeFlow CRM";

/** The official symbol, always kept at its own proportions (never stretched or cropped). */
export function PipeflowSymbol({ className, alt = PIPEFLOW_NAME }: { className?: string; alt?: string }) {
  return <img src={PIPEFLOW_LOGO_URL} alt={alt} className={cn("h-10 w-10 shrink-0 object-contain", className)} />;
}

/** Symbol with the product name beside it. */
export function PipeflowLogo({
  className,
  symbolClassName,
  textClassName,
}: {
  className?: string;
  symbolClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <PipeflowSymbol alt="" className={symbolClassName} />
      <span className={cn("text-lg font-semibold tracking-tight", textClassName)}>{PIPEFLOW_NAME}</span>
    </span>
  );
}
