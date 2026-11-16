/**
 * Sun orb fragment shader. Ported from prototypes/sun-orb.html.
 *
 * There is no blur pass. Every edge is a smoothstep on a signed distance, so softness costs nothing
 * and does not depend on resolution.
 *
 * All geometry is in the pixel space of the reference frame (1910 x 1700, y down). The shader fits that
 * space to the canvas by height and centres it by width, so each number can be checked against the frame.
 */
export const FRAG = /* glsl */ `
precision highp float;
uniform vec2  uRes;
uniform float uRise;        // 0 = under the frame, 1 = up
uniform float uEnergy;      // extra saturation while rising
uniform float uPulse;       // white core pulse
uniform float uWarm;        // "Approved" palette mix
uniform float uDusk;        // "Dusk" palette mix
uniform float uSweep;       // strength of the light that goes around the glow
uniform float uSweepAngle;
uniform float uSoft;        // multiplies every soft edge
uniform float uSize;
uniform float uHorizon;     // px in reference space
uniform float uNotch;
uniform vec3  uBg;
uniform vec3  uDomeTop; uniform vec3 uDomeLow; uniform vec3 uRim;
uniform vec3  uGlowTop; uniform vec3 uGlowSide; uniform vec3 uMauve; uniform vec3 uViolet; uniform vec3 uBlue;
uniform vec3  uBand;    uniform vec3 uBandEnd;

vec3 hex(float r,float g,float b){return vec3(r,g,b)/255.;}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float sdRoundBox(vec2 p, vec2 b, float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
// Soft coverage: 1 inside, 0 outside. The transition is "soft" px on each side of the edge.
float cover(float d,float soft){soft*=uSoft;return 1.-smoothstep(-soft,soft,d);}

// Colour of the outer glow. It depends only on y.
vec3 ringColor(float y){
  vec3 c=uGlowTop;
  c=mix(c,uGlowSide,smoothstep(330.,860.,y));
  c=mix(c,uMauve,smoothstep(900.,1030.,y));
  c=mix(c,uViolet,smoothstep(1040.,1150.,y));
  c=mix(c,uBlue,smoothstep(1150.,1215.,y));
  c=mix(c,mix(uBlue,vec3(1.),.45),smoothstep(1215.,1340.,y));
  return c;
}
vec3 ringWarm(float y){
  vec3 c=hex(253.,214.,160.);
  c=mix(c,hex(255.,156.,124.),smoothstep(330.,900.,y));
  c=mix(c,hex(253.,200.,150.),smoothstep(1050.,1300.,y));
  return c;
}
vec3 ringDusk(float y){
  vec3 c=hex(255.,170.,150.);
  c=mix(c,hex(232.,110.,170.),smoothstep(330.,800.,y));
  c=mix(c,hex(130.,110.,235.),smoothstep(860.,1100.,y));
  c=mix(c,hex(120.,150.,245.),smoothstep(1150.,1330.,y));
  return c;
}

void main(){
  float s=1700./uRes.y;
  vec2 P=vec2((gl_FragCoord.x-uRes.x*.5)*s+955.,(uRes.y-gl_FragCoord.y)*s);

  // Rise: the orb comes up from below and grows a little.
  float rise=uRise;
  float scale=mix(.72,1.,rise)*uSize;
  vec2 C=vec2(955.,930.+(1.-rise)*520.);
  vec2 q=(P-C)/scale+vec2(955.,930.);
  float h=uHorizon;
  float yc=q.y-h*smoothstep(600.,1000.,q.y);     // colour ramps follow the horizon in the lower half

  // 1. Outer glow. Egg shape: narrower toward the top, tighter corners at the bottom.
  vec2 qo=q-vec2(955.,800.);
  qo.x*=1.+.11*smoothstep(850.,300.,q.y);
  float dO=sdRoundBox(qo,vec2(835.,540.),qo.y>0.?400.:540.);
  float aO=cover(dO,135.);
  vec3 rc=ringColor(yc);
  rc=mix(rc,ringWarm(yc),uWarm);
  rc=mix(rc,ringDusk(yc),uDusk);
  // 2. Halo: pale yellow just outside the dome rim, strongest at the top.
  float halo=(1.-smoothstep(0.,150.*uSoft,length(q-vec2(955.,945.))-645.))*(1.-smoothstep(500.,900.,q.y));
  rc=mix(rc,hex(253.,250.,212.),halo*.8);
  // light that goes around the glow (Loading)
  float ang=atan(q.y-930.,q.x-955.);
  float sw=pow(.5+.5*cos(ang-uSweepAngle),3.);
  rc=mix(rc,hex(255.,244.,170.),uSweep*sw*.75);

  // 3. Band: the "water" under the horizon.
  float dB=sdRoundBox(q-vec2(955.,1085.+h),vec2(700.,150.),140.);
  float aB=cover(dB,85.);
  float ends=smoothstep(570.,720.,abs(q.x-955.));
  vec3 band=mix(uBand,uBandEnd,ends);
  band=mix(band,hex(232.,220.,253.),smoothstep(1080.,1200.,q.y-h));
  vec3 bandWarm=mix(hex(253.,227.,170.),hex(253.,214.,165.),smoothstep(1000.,1200.,q.y-h));
  vec3 bandDusk=mix(hex(214.,150.,240.),hex(150.,140.,245.),smoothstep(1000.,1200.,q.y-h));
  band=mix(band,bandWarm,uWarm);
  band=mix(band,bandDusk,uDusk);

  // 4. Dome: a circle cut at the horizon.
  float r=length(q-vec2(955.,945.));
  float cut=30.*uSoft;
  float aD=cover(r-645.,45.)*(1.-smoothstep(945.+h-cut,945.+h+cut,q.y));
  float rim=smoothstep(.72,1.,r/645.);
  vec3 dome=mix(uDomeTop,mix(uDomeTop,uDomeLow,.5),smoothstep(540.,700.,q.y));
  dome=mix(dome,uDomeLow,smoothstep(700.,900.,q.y));
  dome=mix(dome,uRim,rim*.7);
  vec3 domeDusk=mix(hex(255.,236.,200.),hex(255.,176.,150.),smoothstep(420.,900.,q.y));
  dome=mix(dome,domeDusk,uDusk);

  vec3 orb=rc;
  orb=mix(orb,band,aB);
  orb=mix(orb,dome,aD);

  // Energy: push saturation while rising. The early rise is one flat peach tone.
  float l=dot(orb,vec3(.299,.587,.114));
  orb=mix(vec3(l),orb,1.+uEnergy*.9);
  orb=mix(hex(249.,201.,176.),orb,smoothstep(0.,.55,rise));

  // 5. White pulse: grows from the dome centre, covers the dome and the band, leaves the glow.
  float core=1.-smoothstep(0.,1.,length((q-vec2(955.,900.))/vec2(760.,560.))/(.25+uPulse*1.05));
  orb=mix(orb,vec3(1.),clamp(core*uPulse*1.6,0.,1.)*max(aD,aB));
  orb=mix(orb,vec3(1.),clamp(uPulse*.25,0.,1.)*aO);

  vec3 col=mix(uBg,clamp(orb,0.,1.),aO*smoothstep(0.,.25,rise));

  // 6. Notch: a bite of background at the bottom centre.
  float nr=max(1.,uNotch);
  float n=length((q-vec2(955.,1350.))/(vec2(470.,300.)*nr));
  col=mix(col,uBg,(1.-smoothstep(.35,1.05,n))*mix(1.,.8,uDusk)*clamp(uNotch,0.,1.));

  // Ordered dither of +-0.5/255 stops banding in the long soft edges on 8-bit displays.
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}`;
