import type { AgentConfig } from "@/types/eval";

const providerColors: Record<string, string> = {
  openai: "bg-emerald-100 text-emerald-800",
  anthropic: "bg-orange-100 text-orange-800",
  azure: "bg-blue-100 text-blue-800",
  google: "bg-yellow-100 text-yellow-800",
  custom: "bg-gray-100 text-gray-800",
};

interface ProviderBadgeProps {
  provider: AgentConfig["provider"] | string;
}

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${providerColors[provider] ?? providerColors.custom}`}
    >
      {provider}
    </span>
  );
}
