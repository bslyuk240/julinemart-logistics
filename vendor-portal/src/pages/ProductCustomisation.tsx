import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { CustomFieldDefinition } from '../../../src/types/custom-order';

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'colour', label: 'Colour' },
];

const BAKER_TEMPLATE: CustomFieldDefinition[] = [
  {
    id: 'cake_size',
    type: 'dropdown',
    label: 'Cake size',
    required: true,
    options: [
      { label: '6 inch (~8 servings)', value: '6in', price_delta: 0 },
      { label: '8 inch (~15 servings)', value: '8in', price_delta: 5000 },
      { label: '10 inch (~25 servings)', value: '10in', price_delta: 12000 },
    ],
  },
  {
    id: 'flavour',
    type: 'dropdown',
    label: 'Flavour',
    required: true,
    options: [
      { label: 'Vanilla', value: 'vanilla' },
      { label: 'Chocolate', value: 'chocolate' },
      { label: 'Red velvet', value: 'red_velvet', price_delta: 2000 },
      { label: 'Fruit', value: 'fruit', price_delta: 3000 },
    ],
  },
  {
    id: 'message',
    type: 'text',
    label: 'Message on cake',
    placeholder: 'Happy Birthday Ada!',
  },
  {
    id: 'event_date',
    type: 'date',
    label: 'Event / pickup date',
    required: true,
  },
  {
    id: 'servings',
    type: 'number',
    label: 'Expected servings',
    min: 1,
    max: 200,
  },
];

function newField(): CustomFieldDefinition {
  return {
    id: `field_${Date.now()}`,
    type: 'text',
    label: 'New field',
    required: false,
  };
}

export default function ProductCustomisation() {
  const { id: productId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productName, setProductName] = useState('');
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [productionMin, setProductionMin] = useState<number | ''>(2);
  const [productionMax, setProductionMax] = useState<number | ''>(5);
  const [pilotVertical, setPilotVertical] = useState<'bakers' | 'printers' | 'tailors' | ''>(
    'bakers'
  );
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    Promise.all([
      api.getProducts({ search: '', page: '1', per_page: '100' }),
      api.getProductCustomisation(productId),
    ])
      .then(([products, schemaRaw]) => {
        const p = products?.products?.find((x: { id: string }) => x.id === productId);
        setProductName(p?.name || 'Product');
        const schema = schemaRaw as {
          fields?: CustomFieldDefinition[];
          requires_approval?: boolean;
          production_days_min?: number | null;
          production_days_max?: number | null;
          pilot_vertical?: 'bakers' | 'printers' | 'tailors' | null;
        } | null;
        if (schema) {
          setFields(schema.fields || []);
          setRequiresApproval(schema.requires_approval !== false);
          setProductionMin(schema.production_days_min ?? '');
          setProductionMax(schema.production_days_max ?? '');
          setPilotVertical(schema.pilot_vertical || 'bakers');
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  const updateField = (index: number, patch: Partial<CustomFieldDefinition>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!productId) return;
    setSaving(true);
    setError('');
    try {
      await api.saveProductCustomisation(productId, {
        fields,
        requires_approval: requiresApproval,
        production_days_min: productionMin === '' ? null : Number(productionMin),
        production_days_max: productionMax === '' ? null : Number(productionMax),
        pilot_vertical: pilotVertical || null,
      });
      navigate('/products');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const removeSchema = async () => {
    if (!productId || !confirm('Remove customisation from this product?')) return;
    await api.deleteProductCustomisation(productId);
    navigate('/products');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">
      <button
        type="button"
        onClick={() => navigate('/products')}
        className="flex items-center gap-1 text-sm text-gray-600 hover:text-primary-600"
      >
        <ArrowLeft className="w-4 h-4" /> Back to products
      </button>

      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary-600" />
          Custom order builder
        </h1>
        <p className="text-sm text-gray-500 mt-1">{productName}</p>
      </div>

      {error && <div className="card text-red-600 text-sm">{error}</div>}

      <div className="card space-y-3">
        <label className="block text-sm font-medium">Pilot vertical</label>
        <select
          className="input"
          value={pilotVertical}
          onChange={(e) => setPilotVertical(e.target.value as typeof pilotVertical)}
        >
          <option value="bakers">Bakers (cakes & events)</option>
          <option value="printers">Printers</option>
          <option value="tailors">Tailors</option>
        </select>

        <button
          type="button"
          className="text-sm text-primary-600 underline"
          onClick={() => setFields(BAKER_TEMPLATE.map((f) => ({ ...f })))}
        >
          Load baker template
        </button>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Min production days</label>
            <input
              type="number"
              className="input"
              min={0}
              value={productionMin}
              onChange={(e) => setProductionMin(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Max production days</label>
            <input
              type="number"
              className="input"
              min={0}
              value={productionMax}
              onChange={(e) => setProductionMax(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />
          Require seller review before production
        </label>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="card space-y-2">
            <div className="flex justify-between items-start gap-2">
              <input
                className="input font-medium flex-1"
                value={field.label}
                onChange={(e) => updateField(index, { label: e.target.value })}
                placeholder="Field label"
              />
              <button type="button" onClick={() => removeField(index)} className="text-red-500 p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <select
              className="input"
              value={field.type}
              onChange={(e) =>
                updateField(index, { type: e.target.value as CustomFieldDefinition['type'] })
              }
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(field.required)}
                onChange={(e) => updateField(index, { required: e.target.checked })}
              />
              Required
            </label>
            {field.type === 'dropdown' && (
              <textarea
                className="input text-xs font-mono min-h-[80px]"
                placeholder="One option per line: Label | value | +5000"
                value={(field.options || [])
                  .map((o) =>
                    [o.label, o.value, o.price_delta ? `+${o.price_delta}` : ''].filter(Boolean).join(' | ')
                  )
                  .join('\n')}
                onChange={(e) => {
                  const options = e.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const parts = line.split('|').map((p) => p.trim());
                      const pricePart = parts.find((p) => p.startsWith('+'));
                      return {
                        label: parts[0] || 'Option',
                        value: parts[1] || parts[0]?.toLowerCase().replace(/\s+/g, '_') || 'opt',
                        price_delta: pricePart ? Number(pricePart.replace('+', '')) : undefined,
                      };
                    });
                  updateField(index, { options });
                }}
              />
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn-secondary w-full flex items-center justify-center gap-2"
          onClick={() => setFields((prev) => [...prev, newField()])}
        >
          <Plus className="w-4 h-4" /> Add field
        </button>
      </div>

      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 lg:relative bg-white border-t lg:border-0 p-4 flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={removeSchema}>
          Remove
        </button>
        <button type="button" className="btn-primary flex-1" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save customisation'}
        </button>
      </div>
    </div>
  );
}
