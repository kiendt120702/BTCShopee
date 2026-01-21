import * as React from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { Calendar } from "./calendar";

interface DatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  maxDate?: Date;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  maxDate,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4 text-slate-500" />
          <span className="text-slate-700">
            {format(value, "dd/MM/yyyy", { locale: vi })}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[200] bg-white rounded-xl shadow-lg border border-slate-200 p-0 animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="start"
        >
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              if (date) {
                onChange(date);
                setOpen(false);
              }
            }}
            disabled={(date) => maxDate ? date > maxDate : false}
            defaultMonth={value}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
