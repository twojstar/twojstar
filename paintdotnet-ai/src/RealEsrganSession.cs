using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using System;
using System.IO;
using System.Linq;

namespace Travny.PaintDotNet.AI;

internal sealed class RealEsrganSession
{
    public const int Scale = 4;

    private readonly InferenceSession session;
    private readonly string inputName;
    private readonly string outputName;

    public RealEsrganSession(string modelPath)
    {
        var options = new SessionOptions
        {
            GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
            ExecutionMode = ExecutionMode.ORT_SEQUENTIAL,
            InterOpNumThreads = 1,
            IntraOpNumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 4)
        };

        session = new InferenceSession(modelPath, options);
        inputName = session.InputMetadata.Keys.Single();
        outputName = session.OutputMetadata.Keys.Single();
    }

    public float[] Run(float[] input, int width, int height)
    {
        var tensor = new DenseTensor<float>(input, new[] { 1, 3, height, width });
        using IDisposableReadOnlyCollection<DisposableNamedOnnxValue> results =
            session.Run(new[] { NamedOnnxValue.CreateFromTensor(inputName, tensor) });

        Tensor<float> output = results.Single(value => value.Name == outputName).AsTensor<float>();
        int[] dimensions = output.Dimensions.ToArray();
        int expectedHeight = checked(height * Scale);
        int expectedWidth = checked(width * Scale);

        if (dimensions.Length != 4 || dimensions[0] != 1 || dimensions[1] != 3 ||
            dimensions[2] != expectedHeight || dimensions[3] != expectedWidth)
        {
            throw new InvalidDataException(
                $"Unexpected Real-ESRGAN output shape: [{string.Join(", ", dimensions)}].");
        }

        return output.ToArray();
    }
}
