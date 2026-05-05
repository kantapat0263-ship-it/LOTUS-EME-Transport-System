'use server';
/**
 * @fileOverview An AI assistant flow that generates detailed cargo descriptions based on high-level input.
 *
 * - intelligentCargoDescriptionAssistant - A function that handles the generation of detailed cargo descriptions.
 * - CargoDescriptionAssistantInput - The input type for the intelligentCargoDescriptionAssistant function.
 * - CargoDescriptionAssistantOutput - The return type for the intelligentCargoDescriptionAssistant function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CargoDescriptionAssistantInputSchema = z
  .object({
    highLevelDescription: z
      .string()
      .describe(
        'A high-level description of the cargo, e.g., "electrical wiring for ABC site", "plumbing supplies for XYZ project".'
      ),
  })
  .describe('Input for the cargo description assistant.');
export type CargoDescriptionAssistantInput = z.infer<
  typeof CargoDescriptionAssistantInputSchema
>;

const CargoDescriptionAssistantOutputSchema = z
  .object({
    detailedDescription: z
      .string()
      .describe(
        'A detailed, standardized list of cargo items with quantities, e.g., "- Electrical wire (THW, 2.5mm²): 3 rolls\n- PVC conduit (20mm): 50 meters\n- Junction boxes (100x100mm): 10 units".'
      ),
  })
  .describe('Output from the cargo description assistant.');
export type CargoDescriptionAssistantOutput = z.infer<
  typeof CargoDescriptionAssistantOutputSchema
>;

export async function intelligentCargoDescriptionAssistant(
  input: CargoDescriptionAssistantInput
): Promise<CargoDescriptionAssistantOutput> {
  return cargoDescriptionAssistantFlow(input);
}

const cargoDescriptionPrompt = ai.definePrompt({
  name: 'cargoDescriptionPrompt',
  input: {schema: CargoDescriptionAssistantInputSchema},
  output: {schema: CargoDescriptionAssistantOutputSchema},
  prompt: `You are an AI assistant specialized in logistics and inventory management. Your task is to expand a high-level cargo description into a detailed and standardized list of items with specific quantities.

Be as specific as possible regarding item types, sizes, and units. If the exact quantity is not specified, make a reasonable estimate based on typical construction site needs.

Format the output as a bulleted list where each item includes its type, relevant specifications (e.g., size, model), and quantity with units. Ensure consistency and clarity.

High-level cargo description: {{{highLevelDescription}}}`,
});

const cargoDescriptionAssistantFlow = ai.defineFlow(
  {
    name: 'cargoDescriptionAssistantFlow',
    inputSchema: CargoDescriptionAssistantInputSchema,
    outputSchema: CargoDescriptionAssistantOutputSchema,
  },
  async input => {
    const {output} = await cargoDescriptionPrompt(input);
    return output!;
  }
);
