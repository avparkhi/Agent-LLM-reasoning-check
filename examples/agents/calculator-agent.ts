// Example agent definition for evaluation
// Exports tools and system prompt that the eval system can load

export const systemPrompt =
  "You are a calculator assistant. Use the provided tools to perform mathematical calculations. Always use tools for computation rather than calculating in your head.";

export const tools = [
  {
    name: "add",
    description: "Add two numbers together",
    parameters: {
      a: { type: "number", description: "First number", required: true },
      b: { type: "number", description: "Second number", required: true },
    },
    execute: (args: { a: number; b: number }) => ({ result: args.a + args.b }),
  },
  {
    name: "subtract",
    description: "Subtract second number from first",
    parameters: {
      a: { type: "number", description: "Number to subtract from", required: true },
      b: { type: "number", description: "Number to subtract", required: true },
    },
    execute: (args: { a: number; b: number }) => ({ result: args.a - args.b }),
  },
  {
    name: "multiply",
    description: "Multiply two numbers",
    parameters: {
      a: { type: "number", description: "First number", required: true },
      b: { type: "number", description: "Second number", required: true },
    },
    execute: (args: { a: number; b: number }) => ({ result: args.a * args.b }),
  },
  {
    name: "divide",
    description: "Divide first number by second",
    parameters: {
      a: { type: "number", description: "Dividend", required: true },
      b: { type: "number", description: "Divisor (must not be zero)", required: true },
    },
    execute: (args: { a: number; b: number }) => {
      if (args.b === 0) throw new Error("Division by zero");
      return { result: args.a / args.b };
    },
  },
];
