package com.enonic.app.datakit;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.osgi.service.component.annotations.Component;

import com.enonic.xp.home.HomeDir;

@Component(immediate = true)
public class ExportManager
{
    private static final String METADATA_FILE = ".datakit-export.json";

    private static final Pattern NODE_COUNT_PATTERN = Pattern.compile( "\"nodeCount\"\\s*:\\s*(\\d+)" );

    public String list()
    {
        final Path exportDir = getExportDirectory();

        if ( !Files.isDirectory( exportDir ) )
        {
            return "[]";
        }

        final List<String> entries = new ArrayList<>();

        try ( DirectoryStream<Path> stream = Files.newDirectoryStream( exportDir ) )
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
            throw new RuntimeException( "Failed to list exports: " + e.getMessage(), e );
        }

        return "[" + String.join( ",", entries ) + "]";
    }

    public boolean delete( final String name )
    {
        if ( name == null || name.isEmpty() )
        {
            return false;
        }

        final Path exportDir = getExportDirectory();
        final Path target = exportDir.resolve( name ).normalize();

        if ( !target.startsWith( exportDir ) )
        {
            return false;
        }

        try
        {
            if ( Files.isDirectory( target ) )
            {
                deleteRecursively( target );
                deleteSidecarMetadata( exportDir, name );
                return true;
            }

            final Path archive = exportDir.resolve( name + ".zip" ).normalize();
            if ( Files.isRegularFile( archive ) )
            {
                Files.delete( archive );
                deleteSidecarMetadata( exportDir, name );
                return true;
            }

            return false;
        }
        catch ( IOException e )
        {
            throw new RuntimeException( "Failed to delete export '" + name + "': " + e.getMessage(), e );
        }
    }

    public void writeMetadata( final String name, final int nodeCount )
    {
        final Path exportDir = getExportDirectory();
        final Path target = exportDir.resolve( name ).normalize();

        if ( !target.startsWith( exportDir ) )
        {
            return;
        }

        final String json = "{\"nodeCount\":" + nodeCount + "}";
        try
        {
            if ( Files.isDirectory( target ) )
            {
                Files.write( target.resolve( METADATA_FILE ), json.getBytes( StandardCharsets.UTF_8 ) );
            }
            else
            {
                // ? Sidecar file for ZIP archives or when dir no longer exists
                Files.write( exportDir.resolve( name + "." + METADATA_FILE ), json.getBytes( StandardCharsets.UTF_8 ) );
            }
        }
        catch ( IOException e )
        {
            // ? Best-effort: metadata is non-critical
        }
    }

    private Path getExportDirectory()
    {
        return HomeDir.get().toFile().toPath().resolve( "data" ).resolve( "export" );
    }

    private String buildEntryJson( final Path entry )
    {
        final String fileName = entry.getFileName().toString();

        // ? Skip sidecar metadata files
        if ( fileName.endsWith( "." + METADATA_FILE ) )
        {
            return null;
        }

        if ( Files.isDirectory( entry ) )
        {
            return buildDirectoryEntry( entry, fileName );
        }

        if ( fileName.endsWith( ".zip" ) )
        {
            return buildArchiveEntry( entry, fileName.substring( 0, fileName.length() - 4 ) );
        }

        return null;
    }

    private String buildDirectoryEntry( final Path dir, final String name )
    {
        final String timestamp = getLastModified( dir );
        final long nodeCount = readNodeCountFromDir( dir );
        final long size = getDirectorySizeSafe( dir );

        return jsonEntry( name, timestamp, "directory", nodeCount, size );
    }

    private String buildArchiveEntry( final Path archive, final String name )
    {
        try
        {
            final long size = Files.size( archive );
            final String timestamp = getLastModified( archive );
            final long nodeCount = readNodeCountFromSidecar( archive.getParent(), name );

            return jsonEntry( name, timestamp, "zip", nodeCount, size );
        }
        catch ( IOException e )
        {
            final long nodeCount = readNodeCountFromSidecar( archive.getParent(), name );
            return jsonEntry( name, getLastModified( archive ), "zip", nodeCount, -1 );
        }
    }

    private long readNodeCountFromDir( final Path dir )
    {
        return readNodeCountFromFile( dir.resolve( METADATA_FILE ) );
    }

    private long readNodeCountFromSidecar( final Path exportDir, final String name )
    {
        return readNodeCountFromFile( exportDir.resolve( name + "." + METADATA_FILE ) );
    }

    private long readNodeCountFromFile( final Path metadata )
    {
        if ( !Files.isRegularFile( metadata ) )
        {
            return -1;
        }

        try
        {
            final String content = new String( Files.readAllBytes( metadata ), StandardCharsets.UTF_8 );
            final Matcher matcher = NODE_COUNT_PATTERN.matcher( content );
            if ( matcher.find() )
            {
                return Long.parseLong( matcher.group( 1 ) );
            }
            return -1;
        }
        catch ( IOException | NumberFormatException e )
        {
            return -1;
        }
    }

    private void deleteSidecarMetadata( final Path exportDir, final String name )
    {
        try
        {
            final Path sidecar = exportDir.resolve( name + "." + METADATA_FILE );
            Files.deleteIfExists( sidecar );
        }
        catch ( IOException e )
        {
            // ? Best-effort cleanup
        }
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

    private String jsonEntry( final String name, final String timestamp, final String format, final long nodeCount,
                              final long size )
    {
        return "{" +
            "\"name\":" + jsonString( name ) + "," +
            "\"timestamp\":" + jsonString( timestamp ) + "," +
            "\"format\":" + jsonString( format ) + "," +
            "\"nodeCount\":" + nodeCount + "," +
            "\"size\":" + size +
            "}";
    }

    private String jsonString( final String value )
    {
        if ( value == null || value.isEmpty() )
        {
            return "\"\"";
        }
        final StringBuilder sb = new StringBuilder( value.length() + 2 );
        sb.append( '"' );
        for ( int i = 0; i < value.length(); i++ )
        {
            final char c = value.charAt( i );
            switch ( c )
            {
                case '\\':
                    sb.append( "\\\\" );
                    break;
                case '"':
                    sb.append( "\\\"" );
                    break;
                case '\n':
                    sb.append( "\\n" );
                    break;
                case '\r':
                    sb.append( "\\r" );
                    break;
                case '\t':
                    sb.append( "\\t" );
                    break;
                default:
                    if ( c < 0x20 )
                    {
                        sb.append( String.format( "\\u%04x", (int) c ) );
                    }
                    else
                    {
                        sb.append( c );
                    }
            }
        }
        sb.append( '"' );
        return sb.toString();
    }
}
