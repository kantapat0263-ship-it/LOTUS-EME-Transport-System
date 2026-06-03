'use server';
/**
 * @fileOverview An AI agent that analyzes trip history data to generate performance insights.
 *
 * - generatePerformanceInsights - A function that handles the generation of performance insights.
 * - PerformanceInsightsInput - The input type for the generatePerformanceInsights function.
 * - PerformanceInsightsOutput - The return type for the generatePerformanceInsights function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const TripDataSchema = z.object({
  tripId: z.string().describe('Unique identifier for the trip.'),
  driverName: z.string().describe('Name of the driver assigned to the trip.'),
  vehicleType: z.string().describe('Type of vehicle used for the trip.'),
  siteName: z.string().describe('Name of the destination construction site.'),
  plannedDepartureTime: z.string().datetime().describe('Planned departure time as an ISO string.'),
  actualDepartureTime: z.string().datetime().nullable().describe('Actual departure time as an ISO string, if available.'),
  plannedArrivalTime: z.string().datetime().describe('Planned arrival time at the destination as an ISO string.'),
  actualArrivalTime: z.string().datetime().nullable().describe('Actual arrival time at the destination as an ISO string, if available.'),
  cargoNotes: z.string().describe('Description of the cargo for this trip.'),
  tripDate: z.string().datetime().describe('Date of the trip as an ISO string.'),
  status: z.enum(['Planned', 'In Progress', 'Completed', 'Cancelled']).describe('Current status of the trip.'),
});

const PerformanceInsightsInputSchema = z.object({
  trips: z.array(TripDataSchema).describe('A list of trip history data to analyze.'),
});
export type PerformanceInsightsInput = z.infer<typeof PerformanceInsightsInputSchema>;

const InsightSchema = z.object({
  description: z.string().describe('A specific insight, e.g., \'Driver X consistently completes deliveries faster than average.\''),
  category: z.string().describe('Category of the insight, e.g., \'Driver Performance\', \'Site Issue\', \'Logistics Anomaly\', \'Efficiency\''),
});

const PerformanceInsightsOutputSchema = z.object({
  summary: z.string().describe('Overall summary of trip performance.'),
  insights: z.array(InsightSchema).describe('A list of specific, actionable insights.'),
});
export type PerformanceInsightsOutput = z.infer<typeof PerformanceInsightsOutputSchema>;

export async function generatePerformanceInsights(input: PerformanceInsightsInput): Promise<PerformanceInsightsOutput> {
  return performanceInsightsFlow(input);
}

const performanceInsightsPrompt = ai.definePrompt({
  name: 'performanceInsightsPrompt',
  input: { schema: PerformanceInsightsInputSchema },
  output: { schema: PerformanceInsightsOutputSchema },
  prompt: `You are an expert operations analyst for a transport management company called LOTUS EME. Your task is to analyze the provided trip history data and generate concise, natural language summaries, and identify notable trends or anomalies that provide actionable insights into operational efficiency and areas for improvement.

Analyze the following trips:

{{#each trips}}
--- Trip ID: {{{tripId}}} ---
Driver: {{{driverName}}}
Vehicle Type: {{{vehicleType}}}
Site: {{{siteName}}}
Date: {{{tripDate}}}
Planned Departure: {{{plannedDepartureTime}}}
Actual Departure: {{{actualDepartureTime}}}
Planned Arrival: {{{plannedArrivalTime}}}
Actual Arrival: {{{actualArrivalTime}}}
Cargo Notes: {{{cargoNotes}}}
Status: {{{status}}}
--------------------------
{{/each}}

Based on the above data, provide:
1. A general summary of the trip performance.
2. A list of specific insights. Each insight should be a clear, actionable observation.
   Look for:
   - Consistent driver performance (faster/slower than average, punctual/late).
   - Specific site issues (frequent delays, specific cargo challenges).
   - Anomalies (unexpected delays, unusually fast trips, discrepancies in cargo notes).
   - Efficiency improvements.

Provide the output in JSON format matching the following schema:
\`\`\`json
{
  "summary": "Overall summary of trip performance.",
  "insights": [
    {
      "description": "A specific insight, e.g., 'Driver X consistently completes deliveries faster than average.'",
      "category": "E.g., 'Driver Performance', 'Site Issue', 'Logistics Anomaly', 'Efficiency'"
    }
  ]
}
\`\`\`
`,
});

const performanceInsightsFlow = ai.defineFlow(
  {
    name: 'performanceInsightsFlow',
    inputSchema: PerformanceInsightsInputSchema,
    outputSchema: PerformanceInsightsOutputSchema,
  },
  async (input) => {
    const { output } = await performanceInsightsPrompt(input);
    return output!;
  }
);
