/**
 * ReviewsAutoReplyPage - Trang cấu hình trả lời đánh giá tự động
 * Mobile-optimized design
 */

import { useState, useEffect } from 'react';
import {
  Bot,
  Settings,
  MessageSquare,
  Star,
  Zap,
  Save,
  Plus,
  Trash2,
  Edit2,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  Activity,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useAutoReply, DEFAULT_REPLY_TEMPLATES, type AutoReplyConfig } from '@/hooks/useAutoReply';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

export default function ReviewsAutoReplyPage() {
  const { selectedShopId } = useShopeeAuth();
  const {
    config,
    jobStatus,
    logs,
    loading,
    saving,
    saveConfig,
    toggleEnabled,
    triggerProcess,
  } = useAutoReply(selectedShopId);

  // Local state for editing
  const [replyTemplates, setReplyTemplates] = useState(DEFAULT_REPLY_TEMPLATES);
  const [delayMinutes, setDelayMinutes] = useState(60);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [onlyUnreplied, setOnlyUnreplied] = useState(true);
  const [batchSize, setBatchSize] = useState(100);

  // Editing state for specific rating
  const [editingRating, setEditingRating] = useState<'1' | '2' | '3' | '4' | '5' | null>(null);
  const [editingTemplates, setEditingTemplates] = useState<string[]>([]);

  // Load config into local state
  useEffect(() => {
    if (config) {
      setReplyTemplates(config.reply_templates);
      setDelayMinutes(config.reply_delay_minutes);
      setMinRating(config.min_rating_to_reply);
      setOnlyUnreplied(config.only_reply_unreplied);
      setBatchSize(config.batch_size || 100);
    }
  }, [config]);

  const handleSaveConfig = async () => {
    const success = await saveConfig({
      enabled: config?.enabled ?? false,
      reply_templates: replyTemplates,
      reply_delay_minutes: delayMinutes,
      min_rating_to_reply: minRating,
      only_reply_unreplied: onlyUnreplied,
      batch_size: batchSize,
      auto_reply_schedule: config?.auto_reply_schedule || '*/30 * * * *',
    });

    return success;
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    await toggleEnabled(enabled);
  };

  const handleEditRating = (rating: '1' | '2' | '3' | '4' | '5') => {
    setEditingRating(rating);
    setEditingTemplates([...replyTemplates[rating]]);
  };

  const handleSaveRatingTemplates = () => {
    if (!editingRating) return;

    setReplyTemplates((prev) => ({
      ...prev,
      [editingRating]: editingTemplates,
    }));
    setEditingRating(null);
  };

  const handleUpdateTemplate = (index: number, value: string) => {
    setEditingTemplates((prev) => {
      const newTemplates = [...prev];
      newTemplates[index] = value;
      return newTemplates;
    });
  };

  const handleAddTemplate = () => {
    if (editingTemplates.length < 5) {
      setEditingTemplates((prev) => [...prev, '']);
    }
  };

  const handleRemoveTemplate = (index: number) => {
    if (editingTemplates.length > 1) {
      setEditingTemplates((prev) => prev.filter((_, i) => i !== index));
    }
  };

  if (!selectedShopId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500">Vui lòng chọn shop để tiếp tục</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // Calculate statistics
  const successRate =
    logs.length > 0
      ? ((logs.filter((l) => l.status === 'success').length / logs.length) * 100).toFixed(1)
      : '0';

  const last24hLogs = logs.filter(
    (l) => new Date(l.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
  );

  return (
    <div className="space-y-4 sm:space-y-6 pb-20 sm:pb-6">
      {/* Header - Mobile optimized */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 bg-orange-100 rounded-lg shrink-0">
              <Bot className="h-5 w-5 sm:h-6 sm:w-6 text-orange-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-slate-800 truncate">
                Tự động trả lời
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 hidden sm:block">
                Cấu hình mẫu trả lời cho mỗi mức sao
              </p>
            </div>
          </div>
          <Button
            onClick={() => triggerProcess()}
            disabled={saving}
            size="sm"
            className="bg-green-500 hover:bg-green-600 shrink-0"
          >
            {saving ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <Play className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Chạy ngay</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Statistics Cards - 2x2 grid on mobile */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-green-100 rounded-lg">
                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Đã reply</p>
                <p className="text-lg sm:text-xl font-bold text-slate-800">
                  {jobStatus?.total_replied || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-blue-100 rounded-lg">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Thành công</p>
                <p className="text-lg sm:text-xl font-bold text-slate-800">{successRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-violet-50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-purple-100 rounded-lg">
                <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">24h qua</p>
                <p className="text-lg sm:text-xl font-bold text-slate-800">{last24hLogs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-orange-100 rounded-lg">
                <Zap className={cn('h-4 w-4 sm:h-5 sm:w-5', config?.enabled ? 'text-orange-600' : 'text-slate-400')} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Trạng thái</p>
                <div className="mt-0.5">
                  {jobStatus?.is_running ? (
                    <Badge className="bg-green-500 text-[10px] sm:text-xs px-1.5 py-0">Đang chạy</Badge>
                  ) : config?.enabled ? (
                    <Badge className="bg-blue-500 text-[10px] sm:text-xs px-1.5 py-0">Đã bật</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 py-0">Đã tắt</Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Toggle - Compact on mobile */}
      <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 sm:p-3 bg-orange-100 rounded-xl shrink-0">
                <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-orange-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800 text-sm sm:text-base">Bật tự động trả lời</h3>
                <p className="text-xs sm:text-sm text-slate-500 truncate">
                  Tự động chạy mỗi 30 phút
                </p>
              </div>
            </div>
            <Switch
              checked={config?.enabled || false}
              onCheckedChange={handleToggleEnabled}
              disabled={saving}
              className="data-[state=checked]:bg-orange-500 shrink-0"
            />
          </div>

          {config?.enabled && (
            <div className="mt-3 p-2.5 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs sm:text-sm text-green-700 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
                <span className="truncate">Tự động trả lời đang hoạt động</span>
              </p>
            </div>
          )}

          {jobStatus?.last_error && (
            <Alert className="mt-3" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs sm:text-sm">
                <strong>Lỗi:</strong> {jobStatus.last_error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Main Content Tabs - Full width on mobile */}
      <Tabs defaultValue="templates" className="space-y-3 sm:space-y-4">
        <TabsList className="grid w-full grid-cols-3 h-11 sm:h-10">
          <TabsTrigger value="templates" className="text-xs sm:text-sm px-1 sm:px-3 gap-1 sm:gap-2">
            <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="truncate">Mẫu</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs sm:text-sm px-1 sm:px-3 gap-1 sm:gap-2">
            <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="truncate">Cài đặt</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs sm:text-sm px-1 sm:px-3 gap-1 sm:gap-2">
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="truncate">Lịch sử</span>
          </TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-3 sm:space-y-4 mt-0">
          <Card>
            <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <MessageSquare className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
                Mẫu trả lời theo sao
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Hệ thống sẽ random chọn 1 câu mỗi lần reply
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0 space-y-2 sm:space-y-3">
              {(['5', '4', '3', '2', '1'] as const).map((rating) => (
                <div
                  key={rating}
                  className="p-3 sm:p-4 border rounded-lg hover:border-orange-200 transition-colors cursor-pointer active:bg-slate-50"
                  onClick={() => handleEditRating(rating)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      {/* Stars - Compact on mobile */}
                      <div className="flex items-center shrink-0">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              'h-3.5 w-3.5 sm:h-4 sm:w-4',
                              i < parseInt(rating)
                                ? 'fill-orange-400 text-orange-400'
                                : 'fill-slate-200 text-slate-200'
                            )}
                          />
                        ))}
                      </div>
                      <Badge variant="outline" className="text-[10px] sm:text-xs shrink-0">
                        {replyTemplates[rating].length} mẫu
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditRating(rating);
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                      <span className="hidden sm:inline ml-2">Sửa</span>
                    </Button>
                  </div>

                  {/* Preview first template - Truncated on mobile */}
                  <p className="text-xs sm:text-sm text-slate-500 mt-2 line-clamp-2 sm:line-clamp-1">
                    {replyTemplates[rating][0]}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Save Button - Fixed on mobile */}
          <div className="hidden sm:flex justify-end">
            <Button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving ? <Spinner className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Lưu cấu hình
            </Button>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-3 sm:space-y-4 mt-0">
          <Card>
            <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
                Cài đặt nâng cao
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0 space-y-4">
              {/* Settings in single column on mobile */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="delay" className="text-sm">Delay time (phút)</Label>
                  <Input
                    id="delay"
                    type="number"
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(parseInt(e.target.value) || 0)}
                    min={0}
                    max={1440}
                    className="mt-1.5"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Chờ X phút sau review mới thì auto-reply
                  </p>
                </div>

                <div>
                  <Label htmlFor="minRating" className="text-sm">Chỉ reply rating ≥ X sao</Label>
                  <Input
                    id="minRating"
                    type="number"
                    value={minRating || ''}
                    onChange={(e) =>
                      setMinRating(e.target.value ? parseInt(e.target.value) : null)
                    }
                    min={1}
                    max={5}
                    placeholder="Để trống = reply tất cả"
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="batchSize" className="text-sm">Số lượng reply mỗi lần</Label>
                  <Input
                    id="batchSize"
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value) || 100)}
                    min={1}
                    max={100}
                    className="mt-1.5"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Tối đa 100 reviews mỗi lần chạy
                  </p>
                </div>
              </div>

              {/* Toggle switch */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-700 text-sm">
                    Chỉ reply reviews chưa trả lời
                  </p>
                  <p className="text-xs text-slate-500">
                    Bỏ qua reviews đã có reply
                  </p>
                </div>
                <Switch
                  checked={onlyUnreplied}
                  onCheckedChange={setOnlyUnreplied}
                  className="data-[state=checked]:bg-orange-500 shrink-0"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs sm:text-sm text-blue-700">
                  Cron job tự động chạy mỗi 30 phút
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="hidden sm:flex justify-end">
            <Button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving ? <Spinner className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Lưu cấu hình
            </Button>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-3 sm:space-y-4 mt-0">
          <Card>
            <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
                Lịch sử auto-reply
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                {logs.length} records gần nhất
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-2 max-h-[400px] sm:max-h-[500px] overflow-y-auto">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={cn(
                      'p-2.5 sm:p-3 border rounded-lg',
                      log.status === 'success' && 'border-green-200 bg-green-50/50',
                      log.status === 'failed' && 'border-red-200 bg-red-50/50',
                      log.status === 'skipped' && 'border-yellow-200 bg-yellow-50/50'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">
                        {log.status === 'success' && (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        )}
                        {log.status === 'failed' && (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        {log.status === 'skipped' && (
                          <AlertCircle className="h-4 w-4 text-yellow-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs sm:text-sm font-medium">
                            #{log.comment_id}
                          </span>
                          <div className="flex items-center">
                            {[...Array(log.rating_star)].map((_, i) => (
                              <Star
                                key={i}
                                className="h-2.5 w-2.5 sm:h-3 sm:w-3 fill-orange-400 text-orange-400"
                              />
                            ))}
                          </div>
                          <span className="text-[10px] sm:text-xs text-slate-400 ml-auto">
                            {new Date(log.created_at).toLocaleString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {log.reply_text}
                        </p>
                        {log.error_message && (
                          <p className="text-xs text-red-600 mt-1 line-clamp-1">
                            {log.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {logs.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    <Clock className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Chưa có lịch sử</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Mobile Fixed Save Button */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white border-t shadow-lg sm:hidden z-40">
        <Button
          onClick={handleSaveConfig}
          disabled={saving}
          className="w-full bg-orange-500 hover:bg-orange-600 h-11"
        >
          {saving ? <Spinner className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Lưu cấu hình
        </Button>
      </div>

      {/* Edit Template Modal - Full screen on mobile */}
      {editingRating && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[80vh] overflow-hidden rounded-t-2xl sm:rounded-xl sm:mx-4 flex flex-col">
            <CardHeader className="p-4 sm:p-6 border-b shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={cn(
                          'h-4 w-4 sm:h-5 sm:w-5',
                          i < parseInt(editingRating)
                            ? 'fill-orange-400 text-orange-400'
                            : 'fill-slate-200 text-slate-200'
                        )}
                      />
                    ))}
                  </div>
                  <CardTitle className="text-base sm:text-lg">
                    Mẫu {editingRating} sao
                  </CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditingRating(null)}
                  className="h-8 w-8 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription className="text-xs sm:text-sm">
                Tối thiểu 1, tối đa 5 mẫu. Random chọn khi reply.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1">
              {editingTemplates.map((template, index) => (
                <div key={index} className="flex gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        Mẫu {index + 1}
                      </Badge>
                    </div>
                    <Textarea
                      value={template}
                      onChange={(e) => handleUpdateTemplate(index, e.target.value)}
                      placeholder={`Nhập mẫu câu trả lời...`}
                      className="min-h-[80px] sm:min-h-[60px] text-sm"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveTemplate(index)}
                    disabled={editingTemplates.length <= 1}
                    className="h-9 w-9 shrink-0 mt-6"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}

              {editingTemplates.length < 5 && (
                <Button
                  variant="outline"
                  onClick={handleAddTemplate}
                  className="w-full border-dashed h-10"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Thêm mẫu câu
                </Button>
              )}
            </CardContent>

            <div className="flex gap-2 p-4 sm:p-6 border-t bg-slate-50 shrink-0">
              <Button
                variant="outline"
                onClick={() => setEditingRating(null)}
                className="flex-1 h-11"
              >
                Hủy
              </Button>
              <Button
                onClick={handleSaveRatingTemplates}
                className="flex-1 bg-orange-500 hover:bg-orange-600 h-11"
              >
                <Save className="h-4 w-4 mr-2" />
                Lưu
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
