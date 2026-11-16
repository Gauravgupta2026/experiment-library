/**
 * Gradient figure, glitch and pixel wipe. Ported from prototypes/pixel-wipe.html.
 * Geometry of the figure is in the 1500 x 848 space of the reference frame (y down).
 */
export const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uPhase; uniform float uWipe; uniform float uGlitch;
uniform float uCols; uniform float uAngle; uniform float uNoise; uniform float uEdgeDepth; uniform float uSoft;
uniform float uHasFigure;
uniform sampler2D uText; uniform sampler2D uFigure;
uniform vec3 uBgTop; uniform vec3 uBgBottom; uniform vec3 uWipeTo;
uniform vec3 uPal1; uniform vec3 uPal2; uniform vec3 uPal3; uniform vec3 uPal4; uniform vec3 uPal5;
uniform vec3 uEdge1; uniform vec3 uEdge2; uniform vec3 uEdge3; uniform vec3 uEdge4;

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}

// Cyclic palette of the figure. One cycle = 1.
vec3 figurePalette(float t){
  t=fract(t)*5.;
  if(t<1.)return mix(uPal1,uPal2,smoothstep(0.,1.,t));
  if(t<2.)return mix(uPal2,uPal3,smoothstep(0.,1.,t-1.));
  if(t<3.)return mix(uPal3,uPal4,smoothstep(0.,1.,t-2.));
  if(t<4.)return mix(uPal4,uPal5,smoothstep(0.,1.,t-3.));
  return mix(uPal5,uPal1,smoothstep(0.,1.,t-4.));
}

vec3 scene(vec2 uv){                                  // uv: 0..1, y down
  vec2 P=uv*vec2(1500.,848.);
  vec3 bg=mix(uBgTop,uBgBottom,uv.y);                 // linear: measured from the reference rows
  float a; float t; float shoulder=0.;
  if(uHasFigure>.5){
    // A user image: its blurred luminance is the mask and also the palette position.
    vec3 c=texture2D(uFigure,uv).rgb;
    float lum=dot(c,vec3(.299,.587,.114));
    float w=.15*uSoft;
    a=smoothstep(.5-w,.5+w,lum); t=lum*.6;
  }else{
    // Head, face, hair and back, shoulder: joined with a smooth minimum, then one soft edge.
    float head=length(P-vec2(745.,300.))-172.;
    float face=length(P-vec2(868.,345.))-52.;
    float back=sdSeg(P,vec2(690.,360.),vec2(640.,900.))-178.;
    float sh=sdSeg(P,vec2(800.,610.),vec2(925.,900.))-42.;
    float d=smin(smin(head,face,40.),smin(back,sh,60.),70.);
    a=1.-smoothstep(-55.*uSoft,45.*uSoft,d);
    t=(P.y-130.)/720.*.42+(P.x-750.)/1500.*.10;
    shoulder=(1.-smoothstep(0.,70.,abs(sh)))*.45*smoothstep(540.,700.,P.y);
  }
  vec3 fig=figurePalette(t+uPhase);
  fig=mix(fig,figurePalette(uPhase),shoulder);        // the shoulder edge takes the first colour again
  return mix(bg,fig,a);
}

void main(){
  vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);  // y down
  vec2 uv=px/uRes;
  // Glitch: one band of the picture shifts sideways, and a few thin lines flash.
  vec2 guv=uv;
  float band=step(.60,uv.y)*step(uv.y,.80);
  guv.x+=uGlitch*band*.045;
  vec3 col=scene(guv);
  vec4 tx=texture2D(uText,guv);
  col=mix(col,tx.rgb,tx.a);
  float ln=step(.9965,hash(vec2(floor(gl_FragCoord.y),floor(uTime*10.))));   // 1 device pixel high
  col=mix(col,vec3(1.),ln*uGlitch*.55);

  // Pixel wipe. Cells are on a fixed grid; only the edge moves.
  float cell=uRes.x/uCols;
  vec2 id=floor(px/cell);
  vec2 cuv=(id+.5)*cell/uRes;
  float n=vnoise(vec2(cuv.x*3.2+uTime*.35,cuv.y*2.+uTime*.2))-.5;
  float n2=vnoise(vec2(cuv.x*9.+3.,uTime*.9))-.5;
  float w=cuv.y+uAngle*cuv.x+n*uNoise+n2*uNoise*.15;   // small value = wiped first
  float span=1.+uAngle+uNoise*.6+.1;
  float prog=mix(-uNoise*.6-.05,span,uWipe);
  float bandW=uEdgeDepth*cell/uRes.y;
  if(uWipe>0.){
    if(w<prog-bandW){col=uWipeTo;}
    else if(w<prog){
      float h=hash(id+floor(uTime*14.)*7.);            // edge colours change about 14 times per second
      if(h<.22)col=uEdge1; else if(h<.42)col=uEdge2; else if(h<.6)col=uEdge3; else if(h<.74)col=uEdge4;
    }
  }
  if(uWipe>=1.)col=uWipeTo;
  gl_FragColor=vec4(col,1.);
}`;
