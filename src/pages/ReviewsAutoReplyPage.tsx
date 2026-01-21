/**
 * ReviewsAutoReplyPage - Trang cấu hình trả lời đánh giá tự động
 * Tích hợp với hệ thống auto-reply mới
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Bot className="h-7 w-7 text-orange-500" />
            Tự động trả lời đánh giá
          </h1>
          <p className="text-slate-500 mt-1">
            Cấu hình 3 câu trả lời cho mỗi mức sao, hệ thống tự động random và gửi
          </p>
        </div>
        <Button
          onClick={() => triggerProcess()}
          disabled={saving}
          className="bg-green-500 hover:bg-green-600"
        >
          {saving ? (
            <Spinner className="h-4 w-4 mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Chạy ngay
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Tổng đã reply</p>
                <p className="text-2xl font-bold text-slate-800">
                  {jobStatus?.total_replied || 0}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Tỷ lệ thành công</p>
                <p className="text-2xl font-bold text-slate-800">{successRate}%</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">24h gần nhất</p>
                <p className="text-2xl font-bold text-slate-800">{last24hLogs.length}</p>
              </div>
              <Activity className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Trạng thái</p>
                <div className="mt-1">
                  {jobStatus?.is_running ? (
                    <Badge className="bg-green-500">Đang chạy</Badge>
                  ) : config?.enabled ? (
                    <Badge className="bg-blue-500">Đã bật</Badge>
                  ) : (
                    <Badge variant="outline">Đã tắt</Badge>
                  )}
                </div>
              </div>
              <Zap
                className={cn(
                  'h-8 w-8',
                  config?.enabled ? 'text-orange-500' : 'text-slate-300'
                )}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Toggle */}
      <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-orange-100 rounded-xl">
                <Zap className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Bật tự động trả lời</h3>
                <p className="text-sm text-slate-500">
                  Hệ thống sẽ tự động chạy mỗi 30 phút (hoặc theo cấu hình)
                </p>
              </div>
            </div>
            <Switch
              checked={config?.enabled || false}
              onCheckedChange={handleToggleEnabled}
              disabled={saving}
              className="data-[state=checked]:bg-orange-500"
            />
          </div>

          {config?.enabled && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Tự động trả lời đang hoạt động
              </p>
            </div>
          )}

          {jobStatus?.last_error && (
            <Alert className="mt-4" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Lỗi gần nhất:</strong> {jobStatus.last_error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="templates" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="templates">Mẫu trả lời</TabsTrigger>
          <TabsTrigger value="settings">Cài đặt</TabsTrigger>
          <TabsTrigger value="logs">Lịch sử</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-slate-600" />
                Cấu hình mẫu trả lời theo số sao
              </CardTitle>
              <CardDescription>
                Mỗi mức sao có tối thiểu 1 câu, tối đa 5 câu. Hệ thống sẽ random chọn 1 câu mỗi lần.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(['5', '4', '3', '2', '1'] as const).map((rating) => (
                <div
                  key={rating}
                  className="p-4 border rounded-lg hover:border-orange-200 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              'h-4 w-4',
                              i < parseInt(rating)
                                ? 'fill-orange-400 text-orange-400'
                                : 'fill-slate-200 text-slate-200'
                            )}
                          />
                        ))}
                      </div>
                      <span className="font-medium text-slate-700">{rating} sao</span>
                      <Badge variant="outline">{replyTemplates[rating].length} mẫu</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditRating(rating)}
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      Chỉnh sửa
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {replyTemplates[rating].slice(0, 3).map((template, index) => (
                      <div
                        key={index}
                        className="text-sm text-slate-600 bg-slate-50 p-2 rounded border"
                      >
                        {index + 1}. {template}
                      </div>
                    ))}
                    {replyTemplates[rating].length > 3 && (
                      <p className="text-xs text-slate-400">
                        +{replyTemplates[rating].length - 3} mẫu khác...
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving ? (
                <Spinner className="h-4 w-4 mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Lưu cấu hình
            </Button>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-slate-600" />
                Cài đặt nâng cao
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="delay">Delay time (phút)</Label>
                  <Input
                    id="delay"
                    type="number"
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(parseInt(e.target.value) || 0)}
                    min={0}
                    max={1440}
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Chờ X phút sau khi có review mới thì mới auto-reply
                  </p>
                </div>

                <div>
                  <Label htmlFor="minRating">Chỉ reply rating ≥ X sao</Label>
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
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Bỏ qua nếu muốn reply tất cả các mức sao
                  </p>
                </div>

                <div>
                  <Label htmlFor="batchSize">Số lượng reply mỗi lần</Label>
                  <Input
                    id="batchSize"
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value) || 100)}
                    min={1}
                    max={100}
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Số reviews tối đa sẽ reply mỗi lần chạy (1-100)
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium text-slate-700">
                    Chỉ reply reviews chưa có trả lời
                  </p>
                  <p className="text-sm text-slate-500">
                    Bỏ qua reviews đã có reply (từ shop hoặc auto)
                  </p>
                </div>
                <Switch
                  checked={onlyUnreplied}
                  onCheckedChange={setOnlyUnreplied}
                  className="data-[state=checked]:bg-orange-500"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Lưu ý:</strong> Cron job tự động chạy mỗi 30 phút. Bạn cũng có thể
                  nhấn "Chạy ngay" để trigger thủ công.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving ? (
                <Spinner className="h-4 w-4 mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Lưu cấu hình
            </Button>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-600" />
                Lịch sử auto-reply
              </CardTitle>
              <CardDescription>
                {logs.length} records gần nhất
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={cn(
                      'p-3 border rounded-lg',
                      log.status === 'success' && 'border-green-200 bg-green-50/50',
                      log.status === 'failed' && 'border-red-200 bg-red-50/50',
                      log.status === 'skipped' && 'border-yellow-200 bg-yellow-50/50'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {log.status === 'success' && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                          {log.status === 'failed' && (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          {log.status === 'skipped' && (
                            <AlertCircle className="h-4 w-4 text-yellow-600" />
                          )}
                          <span className="text-sm font-medium">
                            Comment #{log.comment_id}
                          </span>
                          <div className="flex items-center gap-0.5">
                            {[...Array(log.rating_star)].map((_, i) => (
                              <Star
                                key={i}
                                className="h-3 w-3 fill-orange-400 text-orange-400"
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-slate-600">{log.reply_text}</p>
                        {log.error_message && (
                          <p className="text-xs text-red-600 mt-1">{log.error_message}</p>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 ml-4">
                        {new Date(log.created_at).toLocaleString('vi-VN')}
                      </div>
                    </div>
                  </div>
                ))}

                {logs.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>Chưa có lịch sử auto-reply</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Template Dialog */}
      {editingRating && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Edit2 className="h-5 w-5" />
                Chỉnh sửa mẫu trả lời {editingRating} sao
              </CardTitle>
              <CardDescription>
                Tối thiểu 1 câu, tối đa 5 câu. Hệ thống sẽ random chọn.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editingTemplates.map((template, index) => (
                <div key={index} className="flex gap-2">
                  <Textarea
                    value={template}
                    onChange={(e) => handleUpdateTemplate(index, e.target.value)}
                    placeholder={`Mẫu câu trả lời ${index + 1}...`}
                    className="flex-1"
                    rows={2}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveTemplate(index)}
                    disabled={editingTemplates.length <= 1}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}

              {editingTemplates.length < 5 && (
                <Button
                  variant="outline"
                  onClick={handleAddTemplate}
                  className="w-full border-dashed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Thêm mẫu câu
                </Button>
              )}
            </CardContent>
            <div className="flex gap-2 p-6 pt-0">
              <Button
                variant="outline"
                onClick={() => setEditingRating(null)}
                className="flex-1"
              >
                Hủy
              </Button>
              <Button
                onClick={handleSaveRatingTemplates}
                className="flex-1 bg-orange-500 hover:bg-orange-600"
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
