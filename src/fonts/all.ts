// Every shipped face: `registerFonts(...allFonts)` when bundle size does not matter (Node, tests).
import type { BakedFace } from '../core/fontcodec.ts';
import { dejavuSans } from './dejavu-sans.ts';
import { dejavuSansBold } from './dejavu-sans-bold.ts';
import { dejavuSerif } from './dejavu-serif.ts';
import { dejavuSerifBold } from './dejavu-serif-bold.ts';
import { interRegular } from './inter-regular.ts';
import { interMedium } from './inter-medium.ts';
import { interSemibold } from './inter-semibold.ts';
import { interBold } from './inter-bold.ts';

export { dejavuSans, dejavuSansBold, dejavuSerif, dejavuSerifBold, interRegular, interMedium, interSemibold, interBold };
export const allFonts: readonly BakedFace[] = [dejavuSans, dejavuSansBold, dejavuSerif, dejavuSerifBold, interRegular, interMedium, interSemibold, interBold];
