import { useEffect, useState } from 'react';
import { Mail, CheckCircle, XCircle, RefreshCw, Send } from 'lucide-react';

interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  sent_at: string;
}

interface EmailLogsProps {
  orderId: string;
}

export function EmailLogs({ orderId }: EmailLogsProps) {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, [orderId]);

  const fetchLogs = async () => {
    try {
      const response = await fetch(`/api/orders/${orderId}/emails`);
      const data = await response.json();
      if (data.success) {
        setLogs(data.data);
      }
    } catch (error) {
      console.error('Error fetching email logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const resendEmail = async (emailType: string) => {
    setResending(emailType);
    try {
      const response = await fetch('/api/emails/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, emailType }),
      });

      const data = await response.json();
      if (data.success) {
        alert('Email sent successfully!');
        fetchLogs();
      } else {
        alert('Failed to send email: ' + data.error);
      }
    } catch (error) {
      alert('Error sending email');
    } finally {
      setResending(null);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Email Notifications
        </h3>
        <button
          onClick={fetchLogs}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Mail className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p>No emails sent yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg"
            >
              <div className="flex-shrink-0 mt-1">
                {log.status === 'sent' ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{log.subject}</p>
                <p className="text-sm text-gray-600">To: {log.recipient}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(log.sent_at).toLocaleString()}
                </p>
                {log.error_message && (
                  <p className="text-xs text-red-600 mt-1">
                    Error: {log.error_message}
                  </p>
                )}
              </div>

              {log.status === 'failed' && (
                <button
                  onClick={() => resendEmail(log.subject.toLowerCase().split(' ')[0])}
                  disabled={resending === log.id}
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Resend Buttons */}
      <div className="mt-6 pt-6 border-t">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Manual Email Triggers</h4>
        <div className="flex flex-wrap gap-2">
          {['confirmation', 'processing', 'shipped', 'delivered'].map((type) => (
            <button
              key={type}
              onClick={() => resendEmail(type)}
              disabled={resending === type}
              className="btn-secondary text-xs"
            >
              {resending === type ? 'Sending...' : `Send ${type}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
