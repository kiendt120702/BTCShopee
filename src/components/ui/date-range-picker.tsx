import * as React from "react";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { vi } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronRight, ChevronLeft } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { Calendar } from "./calendar";

export type DateRangePreset = 'today' | 'yesterday' | '7days' | '30days' | 'custom';
export type CustomMode = 'day' | 'week' | 'month' | 'year' | null;

interface DateRangePickerProps {
  dateRange: DateRangePreset;
  customMode: CustomMode;
  startDate: Date;
  endDate: Date;
  onDateRangeChange: (preset: DateRangePreset) => void;
  onCustomModeChange: (mode: CustomMode) => void;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
  disabled?: boolean;
  className?: string;
}

const presets = [
  { value: 'today' as const, label: 'Hôm nay' },
  { value: 'yesterday' as const, label: 'Hôm qua' },
  { value: '7days' as const, label: 'Trong 7 ngày qua' },
  { value: '30days' as const, label: 'Trong 30 ngày qua' },
];

const customModes = [
  { value: 'day' as const, label: 'Theo ngày' },
  { value: 'week' as const, label: 'Theo tuần' },
  { value: 'month' as const, label: 'Theo tháng' },
  { value: 'year' as const, label: 'Theo năm' },
];

function getPresetDateRange(preset: DateRangePreset): { start: Date; end: Date } {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'today':
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return { start: todayStart, end: today };
    case 'yesterday':
      const yesterday = subDays(today, 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayEnd = subDays(today, 1);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return { start: yesterday, end: yesterdayEnd };
    case '7days':
      const sevenDaysAgo = subDays(today, 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      return { start: sevenDaysAgo, end: today };
    case '30days':
      const thirtyDaysAgo = subDays(today, 29);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      return { start: thirtyDaysAgo, end: today };
    default:
      return { start: today, end: today };
  }
}

function formatDateRangeLabel(preset: DateRangePreset, startDate: Date, endDate: Date): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');

  switch (preset) {
    case 'today':
      return `Tới ${hours}:${minutes} hôm nay`;
    case 'yesterday':
      return format(startDate, 'dd-MM-yyyy', { locale: vi });
    case '7days':
    case '30days':
      return `${format(startDate, 'dd-MM-yyyy', { locale: vi })} - ${format(endDate, 'dd-MM-yyyy', { locale: vi })}`;
    default:
      if (startDate.getTime() === endDate.getTime()) {
        return format(startDate, 'dd-MM-yyyy', { locale: vi });
      }
      return `${format(startDate, 'dd-MM-yyyy', { locale: vi })} - ${format(endDate, 'dd-MM-yyyy', { locale: vi })}`;
  }
}

export function DateRangePicker({
  dateRange,
  customMode,
  startDate,
  endDate,
  onDateRangeChange,
  onCustomModeChange,
  onStartDateChange,
  onEndDateChange,
  disabled,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedYear, setSelectedYear] = React.useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = React.useState(new Date().getMonth());

  const handlePresetSelect = (preset: DateRangePreset) => {
    const { start, end } = getPresetDateRange(preset);
    onDateRangeChange(preset);
    onCustomModeChange(null);
    onStartDateChange(start);
    onEndDateChange(end);
    setOpen(false);
  };

  const handleCustomModeSelect = (mode: CustomMode) => {
    onDateRangeChange('custom');
    onCustomModeChange(mode);
  };

  const handleDaySelect = (date: Date | undefined) => {
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      onStartDateChange(start);
      onEndDateChange(end);
      setOpen(false);
    }
  };

  const handleWeekSelect = (date: Date | undefined) => {
    if (date) {
      const start = startOfWeek(date, { weekStartsOn: 1 });
      const end = endOfWeek(date, { weekStartsOn: 1 });
      onStartDateChange(start);
      onEndDateChange(end);
      setOpen(false);
    }
  };

  const handleMonthSelect = (month: number) => {
    const start = startOfMonth(new Date(selectedYear, month));
    const end = endOfMonth(new Date(selectedYear, month));
    onStartDateChange(start);
    onEndDateChange(end);
    setOpen(false);
  };

  const handleYearSelect = (year: number) => {
    const start = startOfYear(new Date(year, 0));
    const end = endOfYear(new Date(year, 0));
    onStartDateChange(start);
    onEndDateChange(end);
    setOpen(false);
  };

  const displayLabel = React.useMemo(() => {
    const presetLabel = presets.find(p => p.value === dateRange)?.label;
    if (presetLabel && dateRange !== 'custom') {
      return presetLabel;
    }
    if (customMode === 'day') return 'Theo ngày';
    if (customMode === 'week') return 'Theo tuần';
    if (customMode === 'month') return 'Theo tháng';
    if (customMode === 'year') return 'Theo năm';
    return 'Chọn thời gian';
  }, [dateRange, customMode]);

  const dateRangeLabel = formatDateRangeLabel(dateRange, startDate, endDate);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            className
          )}
        >
          <span className="text-slate-500">Khung Thời Gian</span>
          <span className="font-medium text-slate-800">{displayLabel}</span>
          <span className="text-slate-500 hidden sm:inline">{dateRangeLabel}</span>
          <CalendarIcon className="h-4 w-4 text-slate-500 ml-1" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[200] bg-white rounded-xl shadow-lg border border-slate-200 animate-in fade-in-0 zoom-in-95 overflow-hidden"
          sideOffset={5}
          align="start"
        >
          <div className="flex min-w-[400px] max-w-[600px]">
            {/* Left Panel - Presets */}
            <div className="w-[180px] border-r border-slate-100 py-2">
              {/* Preset options */}
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetSelect(preset.value)}
                  className={cn(
                    "w-full px-4 py-2.5 text-left text-sm transition-colors",
                    dateRange === preset.value && customMode === null
                      ? "text-orange-600 bg-orange-50"
                      : "text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {preset.label}
                </button>
              ))}

              <div className="border-t border-slate-100 my-2" />

              {/* Custom mode options */}
              {customModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => handleCustomModeSelect(mode.value)}
                  className={cn(
                    "w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between",
                    customMode === mode.value
                      ? "text-orange-600 bg-orange-50"
                      : "text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {mode.label}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>

            {/* Right Panel - Date/Time Selection */}
            <div className="flex-1 p-3">
              {/* Show date range for presets */}
              {dateRange !== 'custom' && customMode === null && (
                <div className="flex items-center justify-center h-full">
                  <span className="text-orange-600 font-medium">
                    {dateRangeLabel}
                  </span>
                </div>
              )}

              {/* Day picker */}
              {customMode === 'day' && (
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={handleDaySelect}
                  disabled={(date) => date > new Date()}
                  defaultMonth={startDate}
                />
              )}

              {/* Week picker */}
              {customMode === 'week' && (
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={handleWeekSelect}
                  disabled={(date) => date > new Date()}
                  defaultMonth={startDate}
                />
              )}

              {/* Month picker */}
              {customMode === 'month' && (
                <div className="p-2">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={() => setSelectedYear(y => y - 1)}
                      className="p-1 hover:bg-slate-100 rounded"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="font-semibold text-lg">{selectedYear}</span>
                    <button
                      onClick={() => setSelectedYear(y => y + 1)}
                      disabled={selectedYear >= new Date().getFullYear()}
                      className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 12 }, (_, i) => {
                      const isCurrentMonth = selectedYear === new Date().getFullYear() && i === new Date().getMonth();
                      const isFuture = selectedYear === new Date().getFullYear() && i > new Date().getMonth();
                      const isSelected = startDate.getFullYear() === selectedYear && startDate.getMonth() === i;

                      return (
                        <button
                          key={i}
                          onClick={() => handleMonthSelect(i)}
                          disabled={isFuture}
                          className={cn(
                            "py-3 px-2 rounded-lg text-sm font-medium transition-colors",
                            isSelected
                              ? "bg-orange-500 text-white"
                              : isCurrentMonth
                                ? "text-orange-600 bg-orange-50"
                                : isFuture
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-700 hover:bg-slate-100"
                          )}
                        >
                          Tháng {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Year picker */}
              {customMode === 'year' && (
                <div className="p-2">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={() => setSelectedYear(y => y - 12)}
                      className="p-1 hover:bg-slate-100 rounded"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="font-semibold text-lg">
                      {selectedYear - 5} - {selectedYear + 6}
                    </span>
                    <button
                      onClick={() => setSelectedYear(y => y + 12)}
                      className="p-1 hover:bg-slate-100 rounded"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 12 }, (_, i) => {
                      const year = selectedYear - 5 + i;
                      const isCurrentYear = year === new Date().getFullYear();
                      const isFuture = year > new Date().getFullYear();
                      const isSelected = startDate.getFullYear() === year;

                      return (
                        <button
                          key={year}
                          onClick={() => handleYearSelect(year)}
                          disabled={isFuture}
                          className={cn(
                            "py-3 px-2 rounded-lg text-sm font-medium transition-colors",
                            isSelected
                              ? "bg-orange-500 text-white"
                              : isCurrentYear
                                ? "text-orange-600 bg-orange-50"
                                : isFuture
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-700 hover:bg-slate-100"
                          )}
                        >
                          {year}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Simple version for backward compatibility
interface SimpleDateRangePickerProps {
  dateRange: 'today' | '7days' | '30days';
  selectedDate: Date;
  onDateRangeChange: (range: 'today' | '7days' | '30days') => void;
  onSelectedDateChange: (date: Date) => void;
  disabled?: boolean;
  className?: string;
}

export function SimpleDateRangePicker({
  dateRange,
  selectedDate,
  onDateRangeChange,
  onSelectedDateChange,
  disabled,
  className,
}: SimpleDateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<'menu' | 'day' | 'month'>('menu');
  const [selectedYear, setSelectedYear] = React.useState(new Date().getFullYear());

  // Reset view when opening
  React.useEffect(() => {
    if (open) {
      setView('menu');
    }
  }, [open]);

  const handlePresetSelect = (preset: 'today' | '7days' | '30days') => {
    onDateRangeChange(preset);
    if (preset === 'today') {
      onSelectedDateChange(new Date());
    }
    setOpen(false);
  };

  const handleDaySelect = (date: Date | undefined) => {
    if (date) {
      onSelectedDateChange(date);
      setOpen(false);
    }
  };

  const handleMonthSelect = (month: number) => {
    const date = endOfMonth(new Date(selectedYear, month));
    const today = new Date();
    onSelectedDateChange(date > today ? today : date);
    setOpen(false);
  };

  const displayLabel = React.useMemo(() => {
    if (dateRange === 'today') return 'Hôm nay';
    if (dateRange === '7days') return '7 ngày';
    if (dateRange === '30days') return '30 ngày';
    return 'Chọn';
  }, [dateRange]);

  const dateRangeLabel = React.useMemo(() => {
    const now = new Date();
    if (dateRange === 'today') {
      return `Tới ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} hôm nay`;
    }
    const days = dateRange === '7days' ? 6 : 29;
    const start = subDays(selectedDate, days);
    return `${format(start, 'dd/MM/yyyy')} - ${format(selectedDate, 'dd/MM/yyyy')}`;
  }, [dateRange, selectedDate]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-medium text-slate-700">{displayLabel}</span>
          <span className="text-slate-400 hidden sm:inline text-[11px]">{dateRangeLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[200] bg-white rounded-xl shadow-lg border border-slate-200 animate-in fade-in-0 zoom-in-95 overflow-hidden w-[280px]"
          sideOffset={5}
          align="start"
        >
          {/* Menu View */}
          {view === 'menu' && (
            <div className="py-2">
              <button
                onClick={() => handlePresetSelect('today')}
                className={cn(
                  "w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between",
                  dateRange === 'today'
                    ? "text-orange-600 bg-orange-50"
                    : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <span>Hôm nay</span>
                {dateRange === 'today' && (
                  <span className="text-xs text-orange-500">{dateRangeLabel}</span>
                )}
              </button>
              <button
                onClick={() => handlePresetSelect('7days')}
                className={cn(
                  "w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between",
                  dateRange === '7days'
                    ? "text-orange-600 bg-orange-50"
                    : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <span>7 ngày qua</span>
                {dateRange === '7days' && (
                  <span className="text-xs text-orange-500">{dateRangeLabel}</span>
                )}
              </button>
              <button
                onClick={() => handlePresetSelect('30days')}
                className={cn(
                  "w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between",
                  dateRange === '30days'
                    ? "text-orange-600 bg-orange-50"
                    : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <span>30 ngày qua</span>
                {dateRange === '30days' && (
                  <span className="text-xs text-orange-500">{dateRangeLabel}</span>
                )}
              </button>

              <div className="border-t border-slate-100 my-2" />

              <button
                onClick={() => setView('day')}
                className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-between"
              >
                <span>Theo ngày</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
              <button
                onClick={() => setView('month')}
                className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-between"
              >
                <span>Theo tháng</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          )}

          {/* Day Picker View */}
          {view === 'day' && (
            <div>
              <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                <button
                  onClick={() => setView('menu')}
                  className="p-1 hover:bg-slate-100 rounded"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium">Chọn ngày</span>
              </div>
              <div className="p-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDaySelect}
                  disabled={(date) => date > new Date()}
                  defaultMonth={selectedDate}
                />
              </div>
            </div>
          )}

          {/* Month Picker View */}
          {view === 'month' && (
            <div>
              <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                <button
                  onClick={() => setView('menu')}
                  className="p-1 hover:bg-slate-100 rounded"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium">Chọn tháng</span>
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setSelectedYear(y => y - 1)}
                    className="p-1.5 hover:bg-slate-100 rounded"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-semibold">{selectedYear}</span>
                  <button
                    onClick={() => setSelectedYear(y => y + 1)}
                    disabled={selectedYear >= new Date().getFullYear()}
                    className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 12 }, (_, i) => {
                    const isFuture = selectedYear === new Date().getFullYear() && i > new Date().getMonth();
                    const isSelected = selectedDate.getFullYear() === selectedYear && selectedDate.getMonth() === i;

                    return (
                      <button
                        key={i}
                        onClick={() => handleMonthSelect(i)}
                        disabled={isFuture}
                        className={cn(
                          "py-2.5 px-2 rounded-lg text-sm font-medium transition-colors",
                          isSelected
                            ? "bg-orange-500 text-white"
                            : isFuture
                              ? "text-slate-300 cursor-not-allowed"
                              : "text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        Th {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
