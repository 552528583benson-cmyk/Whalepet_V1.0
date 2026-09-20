using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class WhalePetInstaller
{
    private const string Version = "v0.15";

    [STAThread]
    private static void Main(string[] args)
    {
        string sourceRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string installRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WhalePet",
            Version
        );
        string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        bool noLaunch = false;
        bool quiet = false;

        for (int index = 0; index < args.Length; index++)
        {
            if (args[index] == "--install-root" && index + 1 < args.Length)
            {
                installRoot = Path.GetFullPath(args[++index]);
            }
            else if (args[index] == "--desktop" && index + 1 < args.Length)
            {
                desktopPath = Path.GetFullPath(args[++index]);
            }
            else if (args[index] == "--no-launch")
            {
                noLaunch = true;
            }
            else if (args[index] == "--quiet")
            {
                quiet = true;
            }
        }

        try
        {
            ValidatePackage(sourceRoot);
            string sourceFull = Path.GetFullPath(sourceRoot).TrimEnd(Path.DirectorySeparatorChar);
            string installFull = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (installFull.StartsWith(sourceFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安装位置不能放在当前解压文件夹内部。");
            }

            Directory.CreateDirectory(installFull);
            CopyDirectory(sourceFull, installFull);
            Directory.CreateDirectory(desktopPath);

            string targetExe = Path.Combine(installFull, "electron.exe");
            string targetApp = Path.Combine(installFull, "resources", "app");
            string targetIcon = Path.Combine(installFull, "WhalePet.ico");
            string shortcutPath = Path.Combine(desktopPath, "WhalePet.lnk");
            CreateShortcut(shortcutPath, targetExe, targetApp, installFull, targetIcon);

            if (!quiet)
            {
                MessageBox.Show(
                    "安装完成！\n\n桌面已经创建 WhalePet 图标。",
                    "WhalePet 朋友分享版",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }

            if (!noLaunch)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetExe,
                    Arguments = Quote(targetApp),
                    WorkingDirectory = installFull,
                    UseShellExecute = true
                });
            }
        }
        catch (Exception error)
        {
            if (!quiet)
            {
                MessageBox.Show(
                    "安装没有完成：\n\n" + error.Message,
                    "WhalePet 安装失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            Environment.ExitCode = 1;
        }
    }

    private static void ValidatePackage(string sourceRoot)
    {
        string[] required =
        {
            Path.Combine(sourceRoot, "electron.exe"),
            Path.Combine(sourceRoot, "resources", "app", "main.js"),
            Path.Combine(sourceRoot, "resources", "app", "drag-math.js"),
            Path.Combine(sourceRoot, "resources", "app", "state-schema.js"),
            Path.Combine(sourceRoot, "resources", "app", "drag-physics.js"),
            Path.Combine(sourceRoot, "resources", "app", "idle-life.js"),
            Path.Combine(sourceRoot, "resources", "app", "assets", "whalepet-hd", "idle.png"),
            Path.Combine(sourceRoot, "resources", "app", "assets", "whalepet-hd", "tool-use.png"),
            Path.Combine(sourceRoot, "resources", "app", "assets", "whalepet-hd", "idle-life", "blink-source.png"),
            Path.Combine(sourceRoot, "resources", "app", "assets", "generated-transitions", "tail-hang", "pose.png"),
            Path.Combine(sourceRoot, "WhalePet.ico")
        };
        foreach (string path in required)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("安装包不完整，缺少文件。请先完整解压 ZIP。", path);
            }
        }
    }

    private static void CopyDirectory(string sourceRoot, string destinationRoot)
    {
        foreach (string directory in Directory.GetDirectories(sourceRoot, "*", SearchOption.AllDirectories))
        {
            string relative = directory.Substring(sourceRoot.Length).TrimStart(Path.DirectorySeparatorChar);
            Directory.CreateDirectory(Path.Combine(destinationRoot, relative));
        }

        foreach (string file in Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            string relative = file.Substring(sourceRoot.Length).TrimStart(Path.DirectorySeparatorChar);
            string destination = Path.Combine(destinationRoot, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            File.Copy(file, destination, true);
        }
    }

    private static void CreateShortcut(
        string shortcutPath,
        string targetExe,
        string targetApp,
        string workingDirectory,
        string iconPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null)
        {
            throw new InvalidOperationException("Windows 快捷方式组件不可用。");
        }

        object shell = Activator.CreateInstance(shellType);
        object shortcut = null;
        try
        {
            shortcut = shellType.InvokeMember(
                "CreateShortcut",
                System.Reflection.BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { shortcutPath }
            );
            Type shortcutType = shortcut.GetType();
            SetProperty(shortcutType, shortcut, "TargetPath", targetExe);
            SetProperty(shortcutType, shortcut, "Arguments", Quote(targetApp));
            SetProperty(shortcutType, shortcut, "WorkingDirectory", workingDirectory);
            SetProperty(shortcutType, shortcut, "IconLocation", iconPath + ",0");
            SetProperty(shortcutType, shortcut, "Description", "可爱的小鲸桌面宠物");
            shortcutType.InvokeMember(
                "Save",
                System.Reflection.BindingFlags.InvokeMethod,
                null,
                shortcut,
                new object[0]
            );
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void SetProperty(Type type, object instance, string name, object value)
    {
        type.InvokeMember(
            name,
            System.Reflection.BindingFlags.SetProperty,
            null,
            instance,
            new object[] { value }
        );
    }

    private static string Quote(string value)
    {
        return "\"" + value + "\"";
    }
}
