import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  clearAriaLabel?: string;
};

export function SearchInput({
  value,
  onValueChange,
  placeholder = "Search...",
  className,
  inputClassName,
  clearAriaLabel = "Clear search"
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-9 w-[240px] pr-8", inputClassName)}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 border border-border/60"
          onClick={() => onValueChange("")}
          aria-label={clearAriaLabel}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
