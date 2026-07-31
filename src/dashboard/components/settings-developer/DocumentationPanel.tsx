import { Book, Code, ExternalLink, Zap } from 'lucide-react';
import {
  DEVELOPER_RESOURCE_LINKS,
  ENV_VAR_GROUPS,
  SYSTEM_ROLES,
  WORKFLOW_STEPS,
} from '../../lib/settingsDeveloperContent';
import { DeveloperResourceLinks } from './DeveloperResourceLinks';

interface DocumentationPanelProps {
  compact?: boolean;
}

export function DocumentationPanel({ compact = false }: DocumentationPanelProps) {
  const sectionClass = compact
    ? 'rounded-2xl bg-white p-4 ring-1 ring-gray-100'
    : 'card';
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={sectionClass}>
        <h2 className={`font-bold text-gray-900 flex items-center gap-2 ${compact ? 'text-sm' : 'text-lg sm:text-2xl mb-4'}`}>
          {!compact && <Zap className="w-6 h-6 text-yellow-500" />}
          Quick start
        </h2>
        <p className="text-gray-700 mb-4">
          JulineMart Logistics Orchestrator (JLO) splits orders by fulfillment hub, calculates shipping with VAT,
          dispatches via Fez and other couriers, and tracks delivery — from JulineMart PWA checkout through admin ops.
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 ml-1">
          {WORKFLOW_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className={sectionClass}>
        <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-lg mb-3'}`}>Staff roles</h2>
        <p className="text-sm text-gray-600 mb-2">
          Active roles: {SYSTEM_ROLES.join(', ')}. WooCommerce sync is retired — catalog and orders are PWA-first.
        </p>
      </div>

      {!compact && <DeveloperResourceLinks />}

      {ENV_VAR_GROUPS.map((group) => (
        <div key={group.title} className={sectionClass}>
          <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-base'}`}>{group.title}</h2>
          <p className="text-sm text-gray-600 mt-1 mb-3">{group.description}</p>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Variable</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {group.vars.map((v) => (
                  <tr key={v.key} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs text-gray-900">
                      {v.key}
                      {v.serverOnly ? (
                        <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold text-gray-500">
                          server
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{v.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!compact && (
        <div className={sectionClass}>
          <h2 className="text-lg font-bold mb-4">External resources</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DEVELOPER_RESOURCE_LINKS.filter((l) => l.external).map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                {link.label.includes('Supabase') ? (
                  <Code className="w-5 h-5 text-gray-600" />
                ) : (
                  <Book className="w-5 h-5 text-gray-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">{link.label}</div>
                  <div className="text-xs text-gray-600">{link.description}</div>
                </div>
                <ExternalLink className="w-4 h-4 shrink-0 text-gray-400" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
