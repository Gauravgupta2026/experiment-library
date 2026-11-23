import { describe, expect, it } from 'vitest';
import { experiments } from '../../src/experiments/registry';
import { checkTraits, luminance, mergeTraits, readPort, writePort, type TraitPort, type Traits } from '../../src/experiments/traits';
import { color, num, type ControlGroup, type ExperimentBody, type Params } from '../../src/experiments/types';

const load = async (id: string): Promise<ExperimentBody> => {
  const meta = experiments.find((e) => e.id === id);
  if (!meta) throw new Error(`no experiment ${id}`);
  return (await meta.load()).default;
};
const port = (body: ExperimentBody, side: 'outputs' | 'inputs', id: string): TraitPort => {
  const p = body.traits[side].find((x) => x.id === id);
  if (!p) throw new Error(`no ${side} port ${id}`);
  return p;
};

describe('contract: every registered experiment declares valid traits', () => {
  for (const meta of experiments) {
    it(meta.id, async () => {
      const body = (await meta.load()).default;
      expect(checkTraits(body.traits, body.defaults, body.groups)).toEqual([]);
      // Every experiment can at least take a palette: the canvas needs a common port on every host.
      expect(body.traits.inputs.some((p) => p.type === 'palette')).toBe(true);
    });
  }
});

describe('checkTraits catches bad declarations', () => {
  const groups: ControlGroup[] = [{ title: 'G', controls: [color('a', 'A'), color('b', 'B'), num('s', 'S', 0, 2, 0.1)] }];
  const defaults: Params = { a: '#000000', b: '#FFFFFF', s: 1 };
  const t = (p: Partial<TraitPort>, side: 'outputs' | 'inputs' = 'outputs'): Traits => {
    const full: TraitPort = { id: 'x', type: 'palette', label: 'X', keys: ['a', 'b'], runtime: true, ...p };
    return side === 'outputs' ? { outputs: [full], inputs: [] } : { outputs: [], inputs: [full] };
  };
  const check = (traits: Traits | undefined): string[] => checkTraits(traits, defaults, groups);
  it('passes a good port', () => { expect(check(t({}))).toEqual([]); });
  it('needs traits', () => { expect(check(undefined)).toEqual(['no traits declared']); });
  it('unknown key', () => { expect(check(t({ keys: ['a', 'zz'] })).join()).toMatch(/'zz' is not a param/); });
  it('palette key must be a colour', () => { expect(check(t({ keys: ['a', 's'] })).join()).toMatch(/not a colour/); });
  it('softness key must be a number', () => { expect(check(t({ type: 'softness', keys: ['a'] })).join()).toMatch(/not a number/); });
  it('palette needs 2 keys', () => { expect(check(t({ keys: ['a'] })).join()).toMatch(/at least 2/); });
  it('curve cannot be runtime in v1', () => { expect(check(t({ type: 'curve' })).join()).toMatch(/cannot be runtime/); });
  it('agent-only port needs a note', () => { expect(check(t({ type: 'shape', runtime: false, keys: [] })).join()).toMatch(/needs a note/); });
  it('inputs cannot be agent-only', () => { expect(check(t({ type: 'shape', runtime: false, keys: [], note: 'n' }, 'inputs')).join()).toMatch(/inputs must be runtime/); });
  it('ids are slugs and unique', () => {
    expect(check({ outputs: [t({ id: 'Bad Id' }).outputs[0] as TraitPort], inputs: [] }).join()).toMatch(/lowercase/);
    const p = t({}).outputs[0] as TraitPort;
    expect(check({ outputs: [p, p], inputs: [] }).join()).toMatch(/duplicate/);
  });
});

describe('palette mapping', () => {
  it('luminance orders black < gray < white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(luminance('#808080')).toBeGreaterThan(0.2);
    expect(luminance('#808080')).toBeLessThan(0.25);
  });

  it('Mesh Gradient palette into Sun Orb changes 6 of 11 colours, keeping light-to-dark order', async () => {
    const mesh = await load('modern-creatives'), orb = await load('sun-orb');
    const out = port(mesh, 'outputs', 'palette'), inp = port(orb, 'inputs', 'palette');
    const value = readPort(out, mesh.defaults, mesh.groups);
    expect(value?.type).toBe('palette');
    const changed = writePort(inp, value!, orb.defaults, orb.groups);
    expect(Object.keys(changed)).toHaveLength(6);
    // Darkest host colour takes the darkest donor colour; lightest takes the lightest.
    const hostByLum = [...inp.keys].sort((a, b) => luminance(String(orb.defaults[a])) - luminance(String(orb.defaults[b])));
    const donorByLum = [...out.keys].map((k) => String(mesh.defaults[k])).sort((a, b) => luminance(a) - luminance(b));
    expect(changed[hostByLum[0] as string]).toBe(donorByLum[0]);
    expect(changed[hostByLum[hostByLum.length - 1] as string]).toBe(donorByLum[donorByLum.length - 1]);
    // Order holds: the changed host colours, read dark to light, are the donor colours dark to light.
    const changedInHostOrder = hostByLum.filter((k) => k in changed).map((k) => changed[k]);
    expect(changedInHostOrder).toEqual(donorByLum);
  });

  it('a larger donor fills every host colour', async () => {
    const orb = await load('sun-orb'), mesh = await load('modern-creatives');
    const value = readPort(port(orb, 'outputs', 'palette'), orb.defaults, orb.groups)!;
    const changed = writePort(port(mesh, 'inputs', 'palette'), value, mesh.defaults, mesh.groups);
    expect(Object.keys(changed).sort()).toEqual([...port(mesh, 'inputs', 'palette').keys].sort());
    // Mesh's darkest colour (red) takes Sun Orb's darkest colour.
    const orbDarkest = port(orb, 'outputs', 'palette').keys.map((k) => String(orb.defaults[k])).sort((a, b) => luminance(a) - luminance(b))[0];
    const meshDarkestKey = port(mesh, 'inputs', 'palette').keys.slice().sort((a, b) => luminance(String(mesh.defaults[a])) - luminance(String(mesh.defaults[b])))[0];
    expect(changed[meshDarkestKey as string]).toBe(orbDarkest);
  });

  it('a one-colour donor goes to the middle rank', () => {
    const groups: ControlGroup[] = [{ title: 'G', controls: [color('a', 'A'), color('b', 'B'), color('c', 'C')] }];
    const host: Params = { a: '#FFFFFF', b: '#000000', c: '#808080' };
    const p: TraitPort = { id: 'palette', type: 'palette', label: 'P', keys: ['a', 'b', 'c'], runtime: true };
    expect(writePort(p, { type: 'palette', colors: ['#123456'] }, host, groups)).toEqual({ c: '#123456' });
  });

  it('ignores a value of another type and agent-only ports', async () => {
    const orb = await load('sun-orb');
    expect(writePort(port(orb, 'inputs', 'palette'), { type: 'softness', u: 0.5 }, orb.defaults, orb.groups)).toEqual({});
    expect(readPort(port(orb, 'outputs', 'shape'), orb.defaults, orb.groups)).toBeNull();
  });
});

describe('softness mapping', () => {
  it('normalises by each control range and snaps to the host step', async () => {
    const orb = await load('sun-orb'), img = await load('imagine');
    // Sun Orb softness 1.4 in 0.3..2.5 is u = 0.5. Imagine 0.2..3 at u = 0.5 is 1.6.
    const v = readPort(port(orb, 'outputs', 'softness'), { ...orb.defaults, softness: 1.4 }, orb.groups)!;
    expect(v.type).toBe('softness');
    if (v.type === 'softness') expect(v.u).toBeCloseTo(0.5, 9);
    expect(writePort(port(img, 'inputs', 'softness'), v, img.defaults, img.groups)).toEqual({ softness: 1.6 });
  });
});

describe('mergeTraits', () => {
  it('applies defaults, then the host tweaks, then wires in order', async () => {
    const orb = await load('sun-orb'), mesh = await load('modern-creatives'), img = await load('imagine');
    const merged = mergeTraits({ defaults: orb.defaults, groups: orb.groups, params: { size: 1.2, softness: 2 } }, [
      { donor: { params: mesh.defaults, groups: mesh.groups, port: port(mesh, 'outputs', 'palette') }, hostPort: port(orb, 'inputs', 'palette') },
      { donor: { params: { ...img.defaults, softness: 0.2 }, groups: img.groups, port: port(img, 'outputs', 'softness') }, hostPort: port(orb, 'inputs', 'softness') },
    ]);
    expect(merged.size).toBe(1.2);              // host tweak kept
    expect(merged.softness).toBe(0.3);          // wire beats the host tweak (u = 0 maps to the host minimum)
    expect(merged.background).not.toBe(orb.defaults.background);   // the background is the lightest; Mesh's lightest moves in
    expect(merged.state).toBe(orb.defaults.state);                 // untouched params stay
  });

  it('a wire between different types changes nothing', async () => {
    const orb = await load('sun-orb'), mesh = await load('modern-creatives');
    const merged = mergeTraits({ defaults: orb.defaults, groups: orb.groups }, [
      { donor: { params: mesh.defaults, groups: mesh.groups, port: port(mesh, 'outputs', 'softness') }, hostPort: port(orb, 'inputs', 'palette') },
    ]);
    expect(merged).toEqual(orb.defaults);
  });
});
