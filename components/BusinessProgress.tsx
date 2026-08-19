"use client";

import React from "react";
import { BUSINESS_FIELDS } from "@/lib/config/fields";

interface Props {
  businessContext?: Record<string, unknown>;
  missingFields?: string[];
  expanded?: boolean;
  onToggle?: () => void;
}

const PRIORITY_TIERS = [
  { label: "Critical", min: 90, color: "tier-critical" },
  { label: "High", min: 70, color: "tier-high" },
  { label: "Medium", min: 50, color: "tier-medium" },
  { label: "Low", min: 0, color: "tier-low" },
];

export function BusinessProgress({ businessContext, missingFields, expanded = true, onToggle }: Props) {
  const missing = new Set(missingFields ?? []);

  const fieldsByTier = PRIORITY_TIERS.map((tier) => ({
    ...tier,
    fields: Object.entries(BUSINESS_FIELDS)
      .filter(([, cfg]) => cfg.priority >= tier.min)
      .filter(
        ([, cfg]) =>
          !PRIORITY_TIERS.find(
            (t) => t.min > tier.min && cfg.priority >= t.min
          )
      )
      .map(([name, cfg]) => ({
        name,
        label: name.replace(/_/g, " "),
        description: cfg.description,
        value: businessContext?.[name],
        filled: !missing.has(name) && !!businessContext?.[name],
      })),
  }));

  const totalFields = Object.keys(BUSINESS_FIELDS).length;
  const filledFields = totalFields - (missingFields?.length ?? totalFields);
  const progress = Math.round((filledFields / totalFields) * 100);

  const handleToggle = () => onToggle?.();

  return (
    <aside id="business-progress">
      <div
        className="progress-header"
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleToggle()}
        aria-expanded={expanded}
        aria-controls="progress-body"
        aria-label={`Business Profile, ${progress}% complete. ${expanded ? "Collapse" : "Expand"}`}
      >
        <div className="progress-title">
          <span className="progress-icon" aria-hidden="true">📊</span>
          <span>Business Profile</span>
        </div>
        <div className="progress-meta">
          <div className="progress-bar-wrap" aria-hidden="true">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-pct" aria-hidden="true">{progress}%</span>
          <span className="collapse-icon" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="progress-body" id="progress-body">
          {fieldsByTier.map((tier) =>
            tier.fields.length === 0 ? null : (
              <div key={tier.label} className={`tier-group ${tier.color}`}>
                <div className="tier-label">{tier.label}</div>
                {tier.fields.map((f) => (
                  <div
                    key={f.name}
                    className={`field-row ${f.filled ? "filled" : "empty"}`}
                    title={f.description}
                  >
                    <span className="field-status" aria-hidden="true">{f.filled ? "✓" : "○"}</span>
                    <span className="field-name">{f.label}</span>
                    {f.filled && f.value != null && (
                      <span className="field-value" title={String(f.value)}>
                        {String(f.value).slice(0, 28)}
                        {String(f.value).length > 28 ? "…" : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </aside>
  );
}
