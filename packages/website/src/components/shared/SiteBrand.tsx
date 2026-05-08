import React from 'react';
import IconInspectr from '@/components/ui/IconInspectr';

interface SiteBrandProps {
  href?: string;
  showInspectr?: boolean;
  compact?: boolean;
}

const SiteBrand = ({ href = '/', showInspectr = true, compact = false }: SiteBrandProps) => {
  const textSize = compact ? 'text-lg' : 'text-xl';
  const iconSize = compact ? 28 : 32;

  return (
    <a href={href} className="flex items-center gap-2.5">
      <IconInspectr width={iconSize} height={iconSize} from="#7c2d12" to="#f97316" />
      <span className={`font-display font-bold text-primary ${textSize}`}>MCPLab</span>
      {showInspectr ? (
        <span className="text-muted-foreground text-[10px]">
          by <span className="link-brand">Inspectr</span>
        </span>
      ) : null}
    </a>
  );
};

export default SiteBrand;
