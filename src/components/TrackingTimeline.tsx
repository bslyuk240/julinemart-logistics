import React from "react";

export interface TrackingEvent {
  id?: string;
  status: string;
  description?: string;
  location_name?: string;
  event_time: string;
}

export function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <p className="text-gray-500 text-sm italic">
        No tracking events available.
      </p>
    );
  }

  return (
    <div className="border-l-2 border-primary-500 pl-4 space-y-6">

      {events.map((ev, index) => (
        <div key={index} className="relative">

          {/* DOT */}
          <div className="w-3 h-3 bg-primary-600 rounded-full absolute -left-1.5 top-1"></div>

          {/* Status Title */}
          <p className="font-semibold text-gray-900 text-sm">
            {ev.status}
          </p>

          {/* Description */}
          {ev.description && (
            <p className="text-gray-700 text-sm mt-1">
              {ev.description}
            </p>
          )}

          {/* Location + Time */}
          {(ev.location_name || ev.event_time) && (
            <p className="text-xs text-gray-500 mt-2">
              {ev.location_name ? `${ev.location_name} — ` : ""}
              {new Date(ev.event_time).toLocaleString()}
            </p>
          )}
        </div>
      ))}

    </div>
  );
}
