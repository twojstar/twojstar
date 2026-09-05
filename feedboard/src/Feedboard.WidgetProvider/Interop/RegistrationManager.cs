// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Adapted from WindowsAppSDK-Samples/Samples/Widgets/cs-console-packaged/WidgetHelper.

using Microsoft.Windows.Widgets.Providers;
using System.Threading;

namespace Feedboard.Interop;

public sealed class RegistrationManager<TWidgetProvider> : IDisposable
    where TWidgetProvider : IWidgetProvider, new()
{
    private static readonly ManualResetEvent ExitRequested = new(false);
    private readonly IDisposable _registeredProvider;
    private bool _disposed;

    private RegistrationManager(IDisposable provider) => _registeredProvider = provider;

    public static RegistrationManager<TWidgetProvider> RegisterProvider()
    {
        ExitRequested.Reset();
        var registration = RegisterClass(typeof(TWidgetProvider).GUID, new WidgetProviderFactory<TWidgetProvider>());
        return new RegistrationManager<TWidgetProvider>(registration);
    }

    public static void RequestExit() => ExitRequested.Set();

    public WaitHandle ExitWaitHandle => ExitRequested;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _registeredProvider.Dispose();
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private static IDisposable RegisterClass(Guid clsid, Com.IClassFactory factory)
    {
        Com.ClassObject.Register(clsid, factory, out var handle);
        return new ClassLifetimeUnregister(handle);
    }

    private sealed class ClassLifetimeUnregister(uint registrationHandle) : IDisposable
    {
        public void Dispose() => Com.ClassObject.Revoke(registrationHandle);
    }
}
