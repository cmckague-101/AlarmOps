import {useEffect,useRef,useState} from 'react';
import {RotateCcw} from 'lucide-react';
import {signatureHasInk,type SavedSignature,type SignaturePoint} from '@fireops/domain';

export default function SignaturePad({value,onChange,label='Signature'}:{value?:SavedSignature;onChange:(signature:SavedSignature)=>void;label?:string}){
  const canvasRef=useRef<HTMLCanvasElement>(null);const drawing=useRef(false);const strokes=useRef<SignaturePoint[][]>(value?.strokes??[]);const [hasInk,setHasInk]=useState(signatureHasInk(value));
  const paint=()=>{const canvas=canvasRef.current;if(!canvas)return;const rect=canvas.getBoundingClientRect();const ratio=window.devicePixelRatio||1;canvas.width=Math.max(1,rect.width*ratio);canvas.height=Math.max(1,rect.height*ratio);const context=canvas.getContext('2d');if(!context)return;context.scale(ratio,ratio);context.strokeStyle='#17201b';context.lineWidth=2.2;context.lineCap='round';context.lineJoin='round';strokes.current.forEach(stroke=>{if(stroke.length<2)return;context.beginPath();stroke.forEach((point,index)=>(index?context.lineTo(point.x*rect.width,point.y*rect.height):context.moveTo(point.x*rect.width,point.y*rect.height)));context.stroke()})};
  useEffect(()=>{strokes.current=value?.strokes??[];setHasInk(signatureHasInk(value));paint()},[value]);
  useEffect(()=>{const resize=()=>paint();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
  const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height}};
  const start=(event:React.PointerEvent<HTMLCanvasElement>)=>{drawing.current=true;event.currentTarget.setPointerCapture(event.pointerId);strokes.current=[...strokes.current,[point(event)]]};
  const move=(event:React.PointerEvent<HTMLCanvasElement>)=>{if(!drawing.current)return;strokes.current[strokes.current.length-1]?.push(point(event));paint()};
  const finish=()=>{if(!drawing.current)return;drawing.current=false;const signature={strokes:strokes.current.filter(stroke=>stroke.length>1)};setHasInk(signatureHasInk(signature));onChange(signature)};
  const clear=()=>{strokes.current=[];setHasInk(false);onChange({strokes:[]});paint()};
  return <div className="signature-pad"><div className="signature-pad-heading"><span>{label}</span>{hasInk&&<button type="button" onClick={clear}><RotateCcw/> Clear</button>}</div><canvas ref={canvasRef} aria-label={`${label} drawing area`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}/><small>Sign with mouse, trackpad, or finger.</small></div>;
}
