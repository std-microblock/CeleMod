import { Fragment, h } from "preact";
import { useRef } from "preact/hooks";
import { useEffect } from "react";

export const ProgressIndicator = ({
    infinite, value, max, size = 100, lineWidth = 5
}: ({
    infinite: true,
    value?: void,
    max?: void,
} | {
    infinite?: false | void,
    value: number,
    max: number
}) & {
    size?: number,
    lineWidth?: number
}) => {
    const refCanvas = useRef<HTMLCanvasElement>(null);
    const refData = useRef<[number, number]>([0, 0]);
    const refFrame = useRef(0);
    useEffect(() => {
        // @ts-ignore
        const canvas = refCanvas.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let cancelAnimation = false;
        const paint = () => {
            if (cancelAnimation) return;

            const frame = refFrame.current;
            ctx.strokeStyle = 'white';
            ctx.lineWidth = lineWidth;
            ctx.clearRect(0, 0, size, size);
            refFrame.current += 0.1;

            let targetStart = 0, targetSize = 0;
            const [refStart, refSize] = refData.current;

            if (infinite) targetSize = Math.sin(frame / 4) * Math.PI * 0.5 + Math.PI * 0.5;
            else targetSize = value / max * Math.PI * 2;

            if (infinite || (
                !infinite && Math.abs(refStart - (Math.PI / 2 * 3)) > 0.2
            )) {
                targetStart = (frame * 1.5) % 10 / 10 * Math.PI * 2;
            }
            else {
                targetStart = (Math.PI / 2 * 3)
            }

            const mix = (a: number, b: number, p: number) => a * (1 - p) + b * p;
            refData.current[0] = targetStart
            refData.current[1] = mix(refSize, targetSize, 0.05);

            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2 - lineWidth * 2, refStart, refStart + refSize);
            ctx.stroke();

            if (!cancelAnimation)
                requestAnimationFrame(paint);
        }

        paint();
        return () => {
            cancelAnimation = true;
        }
    }, [value, max, infinite]);

    return <canvas ref={refCanvas} width={size} height={size}></canvas>
}