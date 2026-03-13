package com.enonic.app.datakit;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import org.osgi.service.component.annotations.Component;

import com.enonic.xp.home.HomeDir;

@Component(immediate = true)
public class DumpManager
{
    private static final Pattern JSON_STRING_PATTERN = Pattern.compile( "\"([^\"]+)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"" );

    private static final Pattern JSON_NUMBER_PATTERN = Pattern.compile( "\"([^\"]+)\"\\s*:\\s*(\\d+)" );

    public String list()
    {
        final Path dumpDir = getDumpDirectory();

        if ( !Files.isDirectory( dumpDir ) )
        {
            return "[]";
        }

        final List<String> entries = new ArrayList<>();

        try ( DirectoryStream<Path> stream = Files.newDirectoryStream( dumpDir ) )
        {
            for ( Path entry : stream )
            {
                final String json = buildEntryJson( entry );
                if ( json != null )
                {
                    entries.add( json );
                }
            }
        }
        catch ( IOException e )
        {
            throw new RuntimeException( "Failed to list dumps: " + e.getMessage(), e );
        }

        return "[" + String.join( ",", entries ) + "]";
    }

    public boolean delete( final String name )
    {
        if ( name == null || name.isEmpty() )
        {
            return false;
        }

        final Path dumpDir = getDumpDirectory();
        final Path target = dumpDir.resolve( name ).normalize();

        if ( !target.startsWith( dumpDir ) )
        {
            return false;
        }

        try
        {
            if ( Files.isDirectory( target ) )
            {
                deleteRecursively( target );
                return true;
            }

            final Path archive = dumpDir.resolve( name + ".zip" ).normalize();
            if ( Files.isRegularFile( archive ) )
            {
                Files.delete( archive );
                return true;
            }

            return false;
        }
        catch ( IOException e )
        {
            throw new RuntimeException( "Failed to delete dump '" + name + "': " + e.getMessage(), e );
        }
    }

    private Path getDumpDirectory()
    {
        return HomeDir.get().toFile().toPath().resolve( "data" ).resolve( "dump" );
    }

    private String buildEntryJson( final Path entry )
    {
        final String name = entry.getFileName().toString();

        if ( Files.isDirectory( entry ) )
        {
            return buildDirectoryEntry( entry, name );
        }

        if ( name.endsWith( ".zip" ) )
        {
            return buildArchiveEntry( entry, name.substring( 0, name.length() - 4 ) );
        }

        return null;
    }

    private String buildDirectoryEntry( final Path dir, final String name )
    {
        final Path dumpJson = dir.resolve( "dump.json" );
        final Path exportProperties = dir.resolve( "export.properties" );

        if ( Files.isRegularFile( dumpJson ) )
        {
            try
            {
                final String content = new String( Files.readAllBytes( dumpJson ), StandardCharsets.UTF_8 );
                final String xpVersion = extractJsonString( content, "xpVersion" );
                final String modelVersion = extractJsonValue( content, "modelVersion" );
                final String timestamp = extractJsonString( content, "timestamp" );
                final long size = getDirectorySize( dir );

                return jsonEntry( name, timestamp, "versioned", xpVersion, modelVersion, size );
            }
            catch ( IOException e )
            {
                return jsonEntry( name, getLastModified( dir ), "versioned", "", "", getDirectorySizeSafe( dir ) );
            }
        }

        if ( Files.isRegularFile( exportProperties ) )
        {
            try ( InputStream is = Files.newInputStream( exportProperties ) )
            {
                final Properties props = new Properties();
                props.load( is );
                final String xpVersion = props.getProperty( "xp.version", "" );

                return jsonEntry( name, getLastModified( dir ), "export", xpVersion, "", getDirectorySize( dir ) );
            }
            catch ( IOException e )
            {
                return jsonEntry( name, getLastModified( dir ), "export", "", "", getDirectorySizeSafe( dir ) );
            }
        }

        return null;
    }

    private String buildArchiveEntry( final Path archive, final String name )
    {
        try
        {
            final long size = Files.size( archive );
            String xpVersion = "";
            String modelVersion = "";
            String timestamp = getLastModified( archive );

            try ( ZipFile zip = new ZipFile( archive.toFile() ) )
            {
                final ZipEntry dumpJsonEntry = findDumpJson( zip );
                if ( dumpJsonEntry != null )
                {
                    try ( InputStream is = zip.getInputStream( dumpJsonEntry ) )
                    {
                        final String content = new String( is.readAllBytes(), StandardCharsets.UTF_8 );
                        xpVersion = extractJsonString( content, "xpVersion" );
                        modelVersion = extractJsonValue( content, "modelVersion" );
                        final String ts = extractJsonString( content, "timestamp" );
                        if ( !ts.isEmpty() )
                        {
                            timestamp = ts;
                        }
                    }
                }
            }

            return jsonEntry( name, timestamp, "archived", xpVersion, modelVersion, size );
        }
        catch ( IOException e )
        {
            return jsonEntry( name, getLastModified( archive ), "archived", "", "", -1 );
        }
    }

    private ZipEntry findDumpJson( final ZipFile zip )
    {
        final Enumeration<? extends ZipEntry> entries = zip.entries();
        while ( entries.hasMoreElements() )
        {
            final ZipEntry entry = entries.nextElement();
            if ( entry.getName().equals( "dump.json" ) || entry.getName().endsWith( "/dump.json" ) )
            {
                return entry;
            }
        }
        return null;
    }

    private long getDirectorySize( final Path dir )
        throws IOException
    {
        long size = 0;
        try ( DirectoryStream<Path> stream = Files.newDirectoryStream( dir ) )
        {
            for ( Path entry : stream )
            {
                if ( Files.isDirectory( entry ) )
                {
                    size += getDirectorySize( entry );
                }
                else if ( Files.isRegularFile( entry ) )
                {
                    size += Files.size( entry );
                }
            }
        }
        return size;
    }

    private long getDirectorySizeSafe( final Path dir )
    {
        try
        {
            return getDirectorySize( dir );
        }
        catch ( IOException e )
        {
            return -1;
        }
    }

    private void deleteRecursively( final Path path )
        throws IOException
    {
        if ( Files.isDirectory( path ) )
        {
            try ( DirectoryStream<Path> stream = Files.newDirectoryStream( path ) )
            {
                for ( Path entry : stream )
                {
                    deleteRecursively( entry );
                }
            }
        }
        Files.delete( path );
    }

    private String extractJsonString( final String json, final String key )
    {
        final Matcher matcher = JSON_STRING_PATTERN.matcher( json );
        while ( matcher.find() )
        {
            if ( matcher.group( 1 ).equals( key ) )
            {
                return matcher.group( 2 );
            }
        }
        return "";
    }

    private String extractJsonValue( final String json, final String key )
    {
        final String number = extractJsonNumber( json, key );
        if ( !number.isEmpty() )
        {
            return number;
        }
        return extractJsonString( json, key );
    }

    private String extractJsonNumber( final String json, final String key )
    {
        final Matcher matcher = JSON_NUMBER_PATTERN.matcher( json );
        while ( matcher.find() )
        {
            if ( matcher.group( 1 ).equals( key ) )
            {
                return matcher.group( 2 );
            }
        }
        return "";
    }

    private String getLastModified( final Path path )
    {
        try
        {
            return Files.getLastModifiedTime( path ).toInstant().toString();
        }
        catch ( IOException e )
        {
            return "";
        }
    }

    private String jsonEntry( final String name, final String timestamp, final String type, final String xpVersion,
                              final String modelVersion, final long size )
    {
        return "{" +
            "\"name\":" + jsonString( name ) + "," +
            "\"timestamp\":" + jsonString( timestamp ) + "," +
            "\"type\":" + jsonString( type ) + "," +
            "\"xpVersion\":" + jsonString( xpVersion ) + "," +
            "\"modelVersion\":" + jsonString( modelVersion ) + "," +
            "\"size\":" + size +
            "}";
    }

    private String jsonString( final String value )
    {
        if ( value == null || value.isEmpty() )
        {
            return "\"\"";
        }
        return "\"" + value.replace( "\\", "\\\\" ).replace( "\"", "\\\"" ) + "\"";
    }
}
