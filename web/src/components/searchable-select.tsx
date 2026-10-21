"use client";

import React, { useId, useState } from "react";

type Choice = { value: string; label: string };

/** Search narrows configured choices; only the native select submits an ID. */
export function SearchableSelect({
  name, label, options, required = false, value, defaultValue = "", onValueChange,
  placeholder = "Choose an option",
}: {
  name: string;
  label: string;
  options: Choice[];
  required?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(defaultValue);
  const requested = value ?? selection;
  const selected = options.some(option => option.value === requested) ? requested : "";
  const term = query.trim().toLocaleLowerCase();
  const matches = options.filter(option => option.label.toLocaleLowerCase().includes(term));
  // Filtering is not a change of assignment. Keep an existing choice visible until changed.
  const visible = options.filter(option => option.value === selected || matches.includes(option));
  const retained = selected && !matches.some(option => option.value === selected);
  return <div className="searchable-select">
    <label htmlFor={`${id}-search`}>Search {label.toLocaleLowerCase()}
      <input id={`${id}-search`} type="search" value={query} autoComplete="off"
        placeholder="Type to narrow choices" aria-controls={`${id}-choices`}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            document.getElementById(`${id}-choices`)?.focus();
          }
        }} />
    </label>
    <label htmlFor={`${id}-choices`}>{label}
      <select id={`${id}-choices`} name={name} required={required} value={selected}
        disabled={!options.length} aria-describedby={`${id}-status`}
        onChange={event => { setSelection(event.target.value); onValueChange?.(event.target.value); }}>
        <option value="">{placeholder}</option>
        {visible.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <span id={`${id}-status`} className="caption" role="status">
      {!options.length ? "No options available." : term
        ? `${matches.length ? `${matches.length} matching choices.` : "No matching choices. Clear or change your search."}${retained ? " Your current selection is kept." : ""}`
        : "Choose a configured entry from the list."}
    </span>
  </div>;
}
