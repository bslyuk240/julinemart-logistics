import type { Request, Response } from 'express';
import { supabaseServer as supabase } from '../../lib/supabaseServer';

export async function getPwaStatsHandler(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('pwa_install_events')
      .select('event_name, platform, created_at');

    if (error) {
      console.error('pwa_install_events query error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    const events = data ?? [];

    const count = (name: string) => events.filter((e) => e.event_name === name).length;
    const countPlatform = (name: string, platform: string) =>
      events.filter((e) => e.event_name === name && e.platform === platform).length;

    const promptShown = count('pwa_install_prompt_shown');
    const installClicked = count('pwa_install_clicked');
    const installAccepted = count('pwa_install_accepted');
    const installDismissed = count('pwa_install_dismissed');
    const appInstalled = count('pwa_appinstalled');
    const standaloneOpens = count('pwa_opened_standalone');

    const androidInstalls = countPlatform('pwa_appinstalled', 'android_desktop') +
      countPlatform('pwa_install_accepted', 'android_desktop');
    const iosStandaloneOpens = countPlatform('pwa_opened_standalone', 'ios');
    const androidStandaloneOpens = countPlatform('pwa_opened_standalone', 'android_desktop');

    // Last 10 events for activity feed
    const recent = [...events]
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 10)
      .map((e) => ({ event_name: e.event_name, platform: e.platform, created_at: e.created_at }));

    return res.status(200).json({
      success: true,
      data: {
        promptShown,
        installClicked,
        installAccepted,
        installDismissed,
        appInstalled,
        standaloneOpens,
        androidInstalls,
        iosStandaloneOpens,
        androidStandaloneOpens,
        recent,
      },
    });
  } catch (err) {
    console.error('getPwaStatsHandler error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load PWA stats' });
  }
}
