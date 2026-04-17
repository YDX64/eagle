'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'react-hot-toast';
import {
  Settings, Clock, Calendar, Play, Save,
  AlertCircle, CheckCircle, RefreshCw, Activity
} from 'lucide-react';

interface CronSettings {
  enabled: boolean;
  time: string;
  daysAhead: number;
  lastRun?: string;
  nextRun?: string;
}

export default function SettingsPage() {
  const [cronSettings, setCronSettings] = useState<CronSettings>({
    enabled: false,
    time: '00:15',
    daysAhead: 1
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingCron, setTestingCron] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('cronSettings');
    if (saved) {
      setCronSettings(JSON.parse(saved));
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = () => {
    setSaving(true);
    try {
      localStorage.setItem('cronSettings', JSON.stringify(cronSettings));

      // Calculate next run time
      const [hours, minutes] = cronSettings.time.split(':');
      const nextRun = new Date();
      nextRun.setHours(parseInt(hours));
      nextRun.setMinutes(parseInt(minutes));
      nextRun.setSeconds(0);

      if (nextRun < new Date()) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      setCronSettings({
        ...cronSettings,
        nextRun: nextRun.toISOString()
      });

      toast.success('Ayarlar kaydedildi');
    } catch (error) {
      toast.error('Ayarlar kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  // Test analysis manually
  const testCronJob = async () => {
    setTestingCron(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(`/api/bulk-analysis?date=${today}&forceRefresh=true`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Analiz başarılı: ${data.count} maç analiz edildi`);
        setCronSettings({
          ...cronSettings,
          lastRun: new Date().toISOString()
        });
      } else {
        throw new Error(data.error || 'Analiz başarısız');
      }
    } catch (error) {
      console.error('Analysis test error:', error);
      toast.error('Analiz başarısız oldu');
    } finally {
      setTestingCron(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Henüz çalıştırılmadı';
    const date = new Date(dateStr);
    return date.toLocaleString('tr-TR');
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          <Settings className="w-8 h-8 inline mr-2" />
          Ayarlar
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Otomatik analiz ve sistem ayarlarını yönetin
        </p>
      </div>

      {/* Automatic Analysis Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Otomatik Günlük Analiz
          </CardTitle>
          <CardDescription>
            Her gün belirlenen saatte tüm maçları otomatik olarak analiz eder
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-analysis" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Otomatik Analizi Aktif Et
            </Label>
            <Switch
              id="auto-analysis"
              checked={cronSettings.enabled}
              onCheckedChange={(checked) => setCronSettings({...cronSettings, enabled: checked})}
            />
          </div>

          {/* Time Setting */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="analysis-time" className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4" />
                Çalışma Saati
              </Label>
              <Input
                id="analysis-time"
                type="time"
                value={cronSettings.time}
                onChange={(e) => setCronSettings({...cronSettings, time: e.target.value})}
                disabled={!cronSettings.enabled}
              />
              <p className="text-xs text-gray-500 mt-1">
                Önerilen: 00:15 (Gece yarısından sonra)
              </p>
            </div>

            <div>
              <Label htmlFor="days-ahead" className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4" />
                İleri Tarihli Analiz
              </Label>
              <select
                id="days-ahead"
                className="w-full px-3 py-2 border rounded-md"
                value={cronSettings.daysAhead}
                onChange={(e) => setCronSettings({...cronSettings, daysAhead: parseInt(e.target.value)})}
                disabled={!cronSettings.enabled}
              >
                <option value={0}>Sadece Bugün</option>
                <option value={1}>Bugün ve Yarın</option>
                <option value={2}>Bugün + 2 Gün</option>
              </select>
            </div>
          </div>

          {/* Status Information */}
          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Son Çalışma:</span>
              <span className="font-medium">{formatDate(cronSettings.lastRun)}</span>
            </div>
            {cronSettings.enabled && cronSettings.nextRun && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Sonraki Çalışma:</span>
                <span className="font-medium text-green-600">{formatDate(cronSettings.nextRun)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={saveSettings}
              disabled={saving}
              className="flex-1"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
            </Button>

            <Button
              variant="outline"
              onClick={testCronJob}
              disabled={testingCron}
            >
              <Play className="w-4 h-4 mr-2" />
              {testingCron ? 'Analiz Ediliyor...' : 'Şimdi Analiz Et'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cron Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Kurulum Talimatları
          </CardTitle>
          <CardDescription>
            Otomatik analizi aktif hale getirmek için
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Vercel Cron Job Kurulumu:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">vercel.json</code> dosyasına ekleyin:
                <pre className="mt-2 bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`{
  "crons": [{
    "path": "/api/cron/daily-analysis",
    "schedule": "15 0 * * *"
  }]
}`}
                </pre>
              </li>
              <li>
                Environment variable ekleyin:
                <pre className="mt-2 bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
                  CRON_SECRET=your-secret-key-here
                </pre>
              </li>
              <li>Deploy edin ve Vercel Dashboard'dan cron job'ı kontrol edin</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Alternatif: GitHub Actions Kurulumu:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">.github/workflows/daily-analysis.yml</code> oluşturun:
                <pre className="mt-2 bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`name: Daily Analysis
on:
  schedule:
    - cron: '15 0 * * *'
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Analysis
        run: |
          curl -X GET \\
            -H "Authorization: Bearer \${{ secrets.CRON_SECRET }}" \\
            https://your-domain.com/api/cron/daily-analysis`}
                </pre>
              </li>
              <li>GitHub Secrets'a <code>CRON_SECRET</code> ekleyin</li>
            </ol>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <CheckCircle className="w-4 h-4 inline mr-1" />
              Cron job kurulumu tamamlandığında, sistem her gün belirlenen saatte otomatik olarak tüm maçları analiz edecek ve sonuçları kaydedecektir.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Servis Ayarları */}
      <Card>
        <CardHeader>
          <CardTitle>Servis Ayarları</CardTitle>
          <CardDescription>
            AwaStats veri servisi ve cache yapılandırması
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              Servis kimlik bilgileri güvenlik nedeniyle sunucu tarafında saklanır. Bu ayarlar sadece bilgi amaçlıdır.
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-gray-600 dark:text-gray-400">Veri Sağlayıcı:</span>
              <span className="font-mono text-xs">AwaStats</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-gray-600 dark:text-gray-400">Rate Limit:</span>
              <span>100 requests/day</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600 dark:text-gray-400">Cache Duration:</span>
              <span>5 minutes (live), 24 hours (past)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}