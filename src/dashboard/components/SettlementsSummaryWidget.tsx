import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function SettlementsSummaryWidget() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState({
    pending: 0,
    approved: 0,
    paid: 0,
    totalShipments: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/settlements/pending');
      const data = await response.json();

      if (data.success) {
        const pending = data.data.reduce((sum: number, p: any) => sum + p.total_amount_due, 0);
        const approved = data.data.reduce((sum: number, p: any) => sum + p.approved_amount, 0);
        const shipments = data.data.reduce((sum: number, p: any) => sum + p.pending_shipments, 0);

        setSummary({
          pending,
          approved,
          paid: 0, // Would need separate query for all-time paid
          totalShipments: shipments,
        });
      }
    } catch (error) {
      console.error('Error fetching settlements:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="card hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => navigate('/dashboard/settlements')}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Courier Settlements</h3>
          <p className="text-sm text-gray-600 mt-1">Pending payments to couriers</p>
        </div>
        <DollarSign className="w-8 h-8 text-green-600" />
      </div>

      {loading ? (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-900">Pending Payment</span>
            </div>
            <span className="text-lg font-bold text-yellow-900">
              ₦{summary.pending.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Approved</span>
            </div>
            <span className="text-lg font-bold text-blue-900">
              ₦{summary.approved.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-900">Pending Shipments</span>
            </div>
            <span className="text-lg font-bold text-purple-900">
              {summary.totalShipments}
            </span>
          </div>

          <button className="w-full btn-primary text-sm mt-2">
            Manage Settlements →
          </button>
        </div>
      )}
    </div>
  );
}
