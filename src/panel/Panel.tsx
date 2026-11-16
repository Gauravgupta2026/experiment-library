import { useState } from 'react';
import type { Control, ExperimentBody, ExperimentMeta, Params, ParamValue } from '../experiments/types';
import { ColorControl, ImageControl, Segmented, Select, Slider, TextControl, Toggle } from './controls';

interface PanelProps {
  meta: ExperimentMeta;
  body: ExperimentBody;
  params: Params;
  preset: string | null;
  onChange(key: string, value: ParamValue): void;
  onAction(id: string): void;
  onPreset(name: string): void;
  onReset(): void;
  onRandomize(): void;
  onCopy(): Promise<boolean>;
}

const Chevron = (): JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
);

function Row({ control, params, defaults, onChange, onAction }: { control: Control; params: Params; defaults: Params; onChange(key: string, v: ParamValue): void; onAction(id: string): void }): JSX.Element {
  const [error, setError] = useState('');
  if (control.kind === 'action') return <div className="row"><button type="button" className="btn full" onClick={() => onAction(control.id)}>{control.label}</button></div>;
  const { key, label } = control;
  const value = params[key];
  const set = (v: ParamValue): void => onChange(key, v);
  // Double-click the label to reset this one control.
  const reset = (): void => { const d = defaults[key]; if (d !== undefined) onChange(key, d); };
  // A segmented control with many options needs the full width: the label goes above it.
  const stack = control.kind === 'segmented' && control.options.length > 3;
  let body: JSX.Element;
  switch (control.kind) {
    case 'number': body = <div className="ctl"><Slider label={label} value={typeof value === 'number' ? value : control.min} min={control.min} max={control.max} step={control.step} unit={control.unit} onChange={set} /></div>; break;
    case 'color': body = <ColorControl label={label} value={typeof value === 'string' ? value : '#000000'} onChange={set} />; break;
    case 'select': body = <div className="ctl"><Select label={label} value={String(value)} options={control.options} onChange={set} /></div>; break;
    case 'segmented': body = <div className="ctl"><Segmented label={label} value={String(value)} options={control.options} onChange={set} wrap={control.options.length > 3} /></div>; break;
    case 'toggle': body = <div className="ctl"><Toggle label={label} value={value === true} onChange={set} /></div>; break;
    case 'text': body = <div className="ctl"><TextControl label={label} value={typeof value === 'string' ? value : ''} maxLength={control.maxLength} onChange={set} /></div>; break;
    case 'image': body = <ImageControl label={label} value={typeof value === 'string' ? value : ''} onChange={set} onError={setError} />; break;
  }
  return (
    <>
      <div className={`row${stack ? ' stack' : ''}`}><span className="label" title={`${label} (double-click to reset)`} onDoubleClick={reset}>{label}</span>{body}</div>
      {error ? <p className="row-error" role="alert">{error}</p> : null}
    </>
  );
}

export function Panel(props: PanelProps): JSX.Element {
  const { meta, body, params, preset } = props;
  const [closed, setClosed] = useState<Record<string, boolean>>(() => Object.fromEntries(body.groups.map((g) => [g.title, g.collapsed === true])));
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => { if (await props.onCopy()) { setCopied(true); window.setTimeout(() => setCopied(false), 1200); } };
  return (
    <>
      <div className="panel-scroll">
        <h2>{meta.title}</h2>
        <p className="desc">{meta.description}</p>
        <div className="meta"><span className="tag">{meta.category}</span>{meta.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
        {body.presets?.length ? (
          <div className="presets"><Segmented label="Preset" value={preset ?? ''} options={body.presets.map((p) => ({ value: p.name, label: p.name }))} onChange={props.onPreset} /></div>
        ) : null}
        {body.groups.map((g) => {
          const open = !closed[g.title];
          return (
            <section className="group" key={g.title} data-open={open}>
              <button type="button" className="group-head" aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [g.title]: open }))}>{g.title}<Chevron /></button>
              {open ? <div className="rows">{g.controls.map((c) => <Row key={c.kind === 'action' ? c.id : c.key} control={c} params={params} defaults={body.defaults} onChange={props.onChange} onAction={props.onAction} />)}</div> : null}
            </section>
          );
        })}
      </div>
      <div className="panel-foot">
        <button type="button" className="btn ghost" onClick={props.onReset}>Reset</button>
        <button type="button" className="btn ghost" onClick={props.onRandomize}>Randomize</button>
        <button type="button" className="btn primary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
    </>
  );
}
