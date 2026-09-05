// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Adapted from WindowsAppSDK-Samples/Samples/Widgets/cs-console-packaged/WidgetHelper.

using Microsoft.Windows.Widgets.Providers;
using System.Runtime.InteropServices;
using WinRT;

namespace Feedboard.Interop;

internal static class Com
{
    internal static class Guids
    {
        public const string IClassFactory = "00000001-0000-0000-C000-000000000046";
        public const string IUnknown = "00000000-0000-0000-C000-000000000046";
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid(Guids.IClassFactory)]
    internal interface IClassFactory
    {
        [PreserveSig]
        int CreateInstance(IntPtr pUnkOuter, ref Guid riid, out IntPtr ppvObject);

        [PreserveSig]
        int LockServer(bool fLock);
    }

    internal static class ClassObject
    {
        public static void Register(Guid clsid, object factory, out uint cookie)
        {
            var result = CoRegisterClassObject(clsid, factory, 0x4, 0x1, out cookie);
            if (result != 0)
            {
                Marshal.ThrowExceptionForHR(result);
            }
        }

        public static int Revoke(uint cookie) => CoRevokeClassObject(cookie);

        [DllImport("ole32.dll")]
        private static extern int CoRegisterClassObject(
            [MarshalAs(UnmanagedType.LPStruct)] Guid rclsid,
            [MarshalAs(UnmanagedType.IUnknown)] object pUnk,
            uint dwClsContext,
            uint flags,
            out uint lpdwRegister);

        [DllImport("ole32.dll")]
        private static extern int CoRevokeClassObject(uint dwRegister);
    }
}

internal sealed class WidgetProviderFactory<T> : Com.IClassFactory
    where T : IWidgetProvider, new()
{
    private const int ClassENoAggregation = -2147221232;
    private const int ENoInterface = -2147467262;

    public int CreateInstance(IntPtr pUnkOuter, ref Guid riid, out IntPtr ppvObject)
    {
        ppvObject = IntPtr.Zero;
        if (pUnkOuter != IntPtr.Zero)
        {
            Marshal.ThrowExceptionForHR(ClassENoAggregation);
        }

        if (riid == typeof(T).GUID || riid == Guid.Parse(Com.Guids.IUnknown))
        {
            ppvObject = MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        }
        else
        {
            Marshal.ThrowExceptionForHR(ENoInterface);
        }

        return 0;
    }

    public int LockServer(bool fLock) => 0;
}
