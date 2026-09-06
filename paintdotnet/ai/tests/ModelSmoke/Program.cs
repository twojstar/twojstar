using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

if (args.Length != 1)
{
    throw new ArgumentException("Usage: ModelSmoke <model.onnx>");
}

using var session = new InferenceSession(args[0]);
string inputName = session.InputMetadata.Keys.Single();
string outputName = session.OutputMetadata.Keys.Single();
const int width = 16;
const int height = 16;

var tensor = new DenseTensor<float>(new[] { 1, 3, height, width });
tensor.Buffer.Span.Fill(0.5f);

using IDisposableReadOnlyCollection<DisposableNamedOnnxValue> results =
    session.Run(new[] { NamedOnnxValue.CreateFromTensor(inputName, tensor) });
Tensor<float> output = results.Single(value => value.Name == outputName).AsTensor<float>();
int[] dimensions = output.Dimensions.ToArray();

if (dimensions.Length != 4 || dimensions[0] != 1 || dimensions[1] != 3 ||
    dimensions[2] != height * 4 || dimensions[3] != width * 4)
{
    throw new InvalidDataException($"Unexpected output shape: [{string.Join(", ", dimensions)}]");
}

if (output.ToArray().Any(value => !float.IsFinite(value)))
{
    throw new InvalidDataException("Model output contains non-finite values.");
}

Console.WriteLine($"Model smoke test passed: [{string.Join(", ", dimensions)}]");
